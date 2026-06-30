import { CodeCommitClient } from '@aws-sdk/client-codecommit';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

export function getCodeCommitClient(override?: AwsCredentials): CodeCommitClient {
  const creds = override ?? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION ?? '',
  };

  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.region) {
    throw new Error(
      'AWS credentials required — set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION in .env or call set_aws_credentials first',
    );
  }

  return new CodeCommitClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
    },
  });
}
