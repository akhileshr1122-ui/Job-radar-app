// Job Radar on Azure, for a small invite-only group.
//   Storage account      : everybody's data + the shared job pool + the run queue
//   Container Apps jobs  : 'bulk' every 4 hours (search once for everybody), 'queue' on demand (uploads, Run, edits)
//   Static Web App (Free): the web app + API, with Microsoft / GitHub sign-in
// Everything runs on consumption/free tiers; a group of friends normally stays inside Azure's free grants.

@description('Short name used for every resource (letters and digits).')
param name string = 'jobradar'

param location string = resourceGroup().location

@description('Static Web Apps only exists in some regions.')
@allowed(['eastus2', 'centralus', 'westus2', 'westeurope', 'eastasia'])
param webLocation string = 'eastus2'

@description('Admins (emails for Microsoft sign-in, usernames for GitHub), comma separated.')
param adminUsers string

@description('Where the runner downloads the engine code from on every run.')
param engineZip string = 'https://codeload.github.com/akhileshr1122-ui/Job-radar-app/zip/refs/heads/main'

@description('Hours between bulk searches (cron).')
param bulkCron string = '15 */4 * * *'

@secure()
param adzunaAppId string = ''
@secure()
param adzunaAppKey string = ''
@secure()
param joobleKey string = ''
@secure()
param rapidApiKey string = ''

@description('Optional: the admin\'s own Claude Pro/Max token (claude setup-token). Used only for admin accounts.')
@secure()
param adminClaudeToken string = ''

@description('Model used for AI resumes paid by the shared key (Plus and Pro plans).')
param sharedAiModel string = 'claude-haiku-4-5-20251001'

@description('Optional: an Anthropic API key that pays for AI resumes of people on the Plus and Pro plans.')
@secure()
param sharedAnthropicKey string = ''

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower(take('${replace(name, '-', '')}${suffix}', 24))

// ---------------------------------------------------------------- storage

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'jobradar'
  properties: { publicAccess: 'None' }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource runQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'jobradar-runs'
}

var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// ---------------------------------------------------------------- runner (Container Apps jobs)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.15') }
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [ { name: 'Consumption', workloadProfileType: 'Consumption' } ]
  }
}

var optionalSecrets = concat(
  empty(adzunaAppId) ? [] : [ { name: 'adzuna-id', value: adzunaAppId } ],
  empty(adzunaAppKey) ? [] : [ { name: 'adzuna-key', value: adzunaAppKey } ],
  empty(joobleKey) ? [] : [ { name: 'jooble-key', value: joobleKey } ],
  empty(rapidApiKey) ? [] : [ { name: 'rapidapi-key', value: rapidApiKey } ],
  empty(sharedAnthropicKey) ? [] : [ { name: 'shared-anthropic-key', value: sharedAnthropicKey } ],
  empty(adminClaudeToken) ? [] : [ { name: 'admin-claude-token', value: adminClaudeToken } ]
)
var secrets = concat([ { name: 'storage-conn', value: storageConn } ], optionalSecrets)

var optionalEnv = concat(
  empty(adzunaAppId) ? [] : [ { name: 'ADZUNA_APP_ID', secretRef: 'adzuna-id' } ],
  empty(adzunaAppKey) ? [] : [ { name: 'ADZUNA_APP_KEY', secretRef: 'adzuna-key' } ],
  empty(joobleKey) ? [] : [ { name: 'JOOBLE_KEY', secretRef: 'jooble-key' } ],
  empty(rapidApiKey) ? [] : [ { name: 'RAPIDAPI_KEY', secretRef: 'rapidapi-key' } ],
  empty(sharedAnthropicKey) ? [] : [ { name: 'SHARED_ANTHROPIC_API_KEY', secretRef: 'shared-anthropic-key' } ],
  empty(adminClaudeToken) ? [] : [ { name: 'ADMIN_CLAUDE_TOKEN', secretRef: 'admin-claude-token' } ]
)
var runnerEnv = concat([
  { name: 'STORAGE_CONNECTION', secretRef: 'storage-conn' }
  { name: 'ENGINE_ZIP', value: engineZip }
  { name: 'PYTHONUNBUFFERED', value: '1' }
  { name: 'ADMIN_USERS', value: adminUsers }
  { name: 'SHARED_AI_MODEL', value: sharedAiModel }
], optionalEnv)

// Download the latest engine, install it, run. Always current with the public repo; no image to build.
var boot = 'set -e; cd /tmp; rm -rf /tmp/src; python3 -c "import io,urllib.request,zipfile; zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(\'$ENGINE_ZIP\').read())).extractall(\'/tmp/src\')"; cd /tmp/src/*/; python3 -m pip install -q --disable-pip-version-check -r engine/requirements.txt azure-storage-blob azure-storage-queue; exec python3 engine/azure_run.py '

var image = 'mcr.microsoft.com/devcontainers/python:3.12'

resource bulkJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${name}-bulk'
  location: location
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 7200
      replicaRetryLimit: 0
      scheduleTriggerConfig: { cronExpression: bulkCron, parallelism: 1, replicaCompletionCount: 1 }
      secrets: secrets
    }
    template: {
      containers: [ {
        name: 'runner'
        image: image
        command: [ '/bin/bash', '-c' ]
        args: [ '${boot}bulk' ]
        env: runnerEnv
        resources: { cpu: json('0.5'), memory: '1Gi' }
      } ]
    }
  }
}

resource queueJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${name}-queue'
  location: location
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 3600
      replicaRetryLimit: 0
      eventTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 1
          pollingInterval: 20
          rules: [ {
            name: 'runs'
            type: 'azure-queue'
            metadata: { queueName: 'jobradar-runs', queueLength: '1', accountName: storage.name }
            auth: [ { secretRef: 'storage-conn', triggerParameter: 'connection' } ]
          } ]
        }
      }
      secrets: secrets
    }
    template: {
      containers: [ {
        name: 'runner'
        image: image
        command: [ '/bin/bash', '-c' ]
        args: [ '${boot}queue' ]
        env: runnerEnv
        resources: { cpu: json('0.5'), memory: '1Gi' }
      } ]
    }
  }
}

// ---------------------------------------------------------------- web app + API

resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${name}-web-${suffix}'
  location: webLocation
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource webSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: web
  name: 'appsettings'
  properties: {
    STORAGE_CONNECTION: storageConn
    ADMIN_USERS: adminUsers
  }
}

output webName string = web.name
output webUrl string = 'https://${web.properties.defaultHostname}'
output storageAccount string = storage.name
