#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SourceAccountStack } from '../lib/source-account-stack';

const app = new cdk.App();
new SourceAccountStack(app, 'SourceAccountStack', {
  env: {
    account: '615299764212', // Replace with your AWS Account ID for Account 2
    region: 'ap-northeast-1',      // Replace with your desired region
  },
});