#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TargetAccountStack } from '../lib/target-account-cdk-stack';

const app = new cdk.App();
new TargetAccountStack(app, 'TargetAccountCdkStack', {
  env: {
    account: '034362059217', // Replace with your AWS Account ID for Account 1
    region: 'ap-northeast-1',      // Replace with your desired region
  },
});