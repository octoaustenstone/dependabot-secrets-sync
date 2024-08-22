import { getInput, info, warning } from "@actions/core";
import { getOctokit } from "@actions/github";

import _sodium from 'libsodium-wrappers';

interface Input {
  token: string;
  secretsInclude: string[];
  secretsExclude: string[];
  owner: string;
  repo: string;
}

const getInputs = (): Input => {
  const result = {} as Input;
  result.token = getInput("github-token");
  result.secretsInclude = JSON.parse(getInput("secrets") || '[]');
  result.secretsExclude = JSON.parse(getInput("secrets-exclude") || '[]');
  result.owner = getInput("owner");
  result.repo = getInput("repo");
  if (result.repo.includes('/')) {
    result.repo = result.repo.split('/')[1];
  }
  return result;
}

export const run = async (): Promise<void> => {
  const input = getInputs();
  const octokit = getOctokit(input.token);
  const _envSecrets = JSON.parse(process.env.SECRETS || '{}');
  const secrets: {
    [key: string]: string;
  } = {};

  if (input.secretsInclude.length === 0) {
    Object.assign(secrets, _envSecrets);
  } else {
    input.secretsInclude.forEach((key: string) => {
      if (secrets[key] === undefined) {
        secrets[key] = _envSecrets[key];
      }
    });
  }
  input.secretsExclude.forEach((key: string) => delete secrets[key]);
  Object.keys(secrets).forEach((key: string) => {
    if (key.startsWith('GITHUB_')) {
      delete secrets[key];
      warning(`Secret ${key} starts with GITHUB_ and will not be added to the repo.`);
    }
  });

  info(`All secrets: ${JSON.stringify(secrets)}`);

  const {
    key,
    key_id
  } = (await octokit.rest.dependabot.getRepoPublicKey({
    owner: input.owner,
    repo: input.repo,
  })).data;

  await _sodium.ready;
  const sodium = _sodium;
  const encryptSecret = (secret: string): string => {
    let binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    let binsec = sodium.from_string(secret)
    let encBytes = sodium.crypto_box_seal(binsec, binkey)
    let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)
    return output;
  }

  Object.entries(secrets).forEach(async ([key, value]) => {
    await octokit.rest.dependabot.createOrUpdateRepoSecret({
      owner: input.owner,
      repo: input.repo,
      secret_name: key,
      encrypted_value: encryptSecret(value),
      key_id,
    });
  });
};

run();
