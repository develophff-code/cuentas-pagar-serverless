import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import type { DeploymentStage } from './environment.js';

export interface MvpDataStackProps extends cdk.StackProps { stage: DeploymentStage }

/** Preparación local; su despliegue requiere revisión del objetivo de USD 20. */
export class MvpDataStack extends cdk.Stack {
  readonly connectionMode = 'data-api' as const;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly clusterArn: string;
  constructor(scope: Construct, id: string, props: MvpDataStackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add('Application', 'cuentas-pagar');
    cdk.Tags.of(this).add('Environment', props.stage);
    cdk.Tags.of(this).add('InfrastructureProfile', 'mvp');
    cdk.Tags.of(this).add('CostApprovalRequired', 'true');
    const vpc = new ec2.Vpc(this, 'DataVpc', { maxAzs: 2, natGateways: 0,
      subnetConfiguration: [{ name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }] });
    const dataVpc = vpc as unknown as ec2.IVpc;
    const securityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: dataVpc, allowAllOutbound: false, description: 'Private Aurora accessed through Data API; no TCP ingress.',
    });
    const secret = new rds.DatabaseSecret(this, 'DatabaseCredentials', {
      username: 'app_owner', dbname: 'cuentas_pagar', secretName: `cuentas-pagar/${props.stage}/mvp-database-credentials`,
    });
    this.databaseSecret = secret as unknown as secretsmanager.ISecret;
    const engine = rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 });
    const database = new rds.DatabaseCluster(this, 'AuroraPostgres', {
      engine, writer: rds.ClusterInstance.serverlessV2('writer'), vpc: dataVpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [securityGroup],
      credentials: rds.Credentials.fromSecret(this.databaseSecret), defaultDatabaseName: 'cuentas_pagar',
      parameterGroup: new rds.ParameterGroup(this, 'PostgresParameters', { engine,
        parameters: { 'rds.force_ssl': '1', timezone: 'UTC' } }),
      enableDataApi: true, storageEncrypted: true,
      serverlessV2MinCapacity: 0, serverlessV2MaxCapacity: 1,
      serverlessV2AutoPauseDuration: cdk.Duration.minutes(5),
      backup: { retention: cdk.Duration.days(7) },
      deletionProtection: true, removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.clusterArn = database.clusterArn;
    // Cifrado administrado: no añadir otra clave KMS de costo fijo al MVP.
    const documents = new s3.Bucket(this, 'Documents', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED, versioned: true,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cdk.CfnOutput(this, 'DatabaseClusterArn', { value: this.clusterArn });
    new cdk.CfnOutput(this, 'DatabaseCredentialsSecretArn', { value: this.databaseSecret.secretArn });
    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: documents.bucketName });
  }
}
