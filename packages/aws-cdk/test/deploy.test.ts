/* eslint-disable import/order */
import * as cxapi from '@aws-cdk/cx-api';
import { deployArtifacts } from '../lib/deploy';
import { WorkNode } from '../lib/util/work-graph';

const ASSET_MANIFEST_ARTIFACT_SYM = Symbol.for('@aws-cdk/cx-api.AssetManifestArtifact');
const CLOUDFORMATION_STACK_ARTIFACT_SYM = Symbol.for('@aws-cdk/cx-api.CloudFormationStackArtifact');

type Artifact = cxapi.CloudArtifact;
type Stack = cxapi.CloudFormationStackArtifact;
type Asset = cxapi.AssetManifestArtifact;

const sleep = async (duration: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), duration));

// Not great to have actual sleeps in the tests, but they mostly just exist to give the async workflow
// a chance to start new tasks.
const SLOW = 200;

/**
 * Repurposing unused stack attributes to create specific test scenarios
 * - stack.name          = deployment duration
 * - stack.displayName   = error message
 */
describe('DeployAssets', () => {
  const actionedAssets: string[] = [];
  const deployStack = async ({ id, displayName, name }: Stack) => {
    const errorMessage = displayName;
    const timeout = Number(name) || 0;

    await sleep(timeout);

    if (errorMessage) {
      throw Error(errorMessage);
    }

    actionedAssets.push(id);
  };
  const buildAsset = async({ id }: WorkNode) => {
    actionedAssets.push(id);
  };
  const publishAsset = async({ id }: WorkNode) => {
    actionedAssets.push(id);
  };

  beforeEach(() => {
    actionedAssets.splice(0);
  });

  // Success
  test.each([
    // Concurrency 1
    { scenario: 'No Stacks', concurrency: 1, toDeploy: [], expected: [] },
    { scenario: 'A', concurrency: 1, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }]), expected: ['A'] },
    { scenario: 'A, B', concurrency: 1, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack' }]), expected: ['A', 'B'] },
    { scenario: 'A -> B', concurrency: 1, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack', stackDependencies: ['A'] }]), expected: ['A', 'B'] },
    { scenario: '[unsorted] A -> B', concurrency: 1, toDeploy: createArtifacts([{ id: 'B', type: 'stack', stackDependencies: ['A'] }, { id: 'A', type: 'stack' }]), expected: ['A', 'B'] },
    { scenario: 'A -> B -> C', concurrency: 1, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack', stackDependencies: ['A'] }, { id: 'C', type: 'stack', stackDependencies: ['B'] }]), expected: ['A', 'B', 'C'] },
    { scenario: 'A -> B, A -> C', concurrency: 1, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack', stackDependencies: ['A'] }, { id: 'C', type: 'stack', stackDependencies: ['A'] }]), expected: ['A', 'B', 'C'] },
    {
      scenario: 'A (slow), B',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', name: SLOW },
        { id: 'B', type: 'stack' },
      ]),
      expected: ['A', 'B'],
    },
    {
      scenario: 'A -> B, C -> D',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack' },
        { id: 'B', type: 'stack', stackDependencies: ['A'] },
        { id: 'C', type: 'stack' },
        { id: 'D', type: 'stack', stackDependencies: ['C'] },
      ]),
      expected: ['A', 'C', 'B', 'D'],
    },
    {
      scenario: 'A (slow) -> B, C -> D',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', name: SLOW },
        { id: 'B', type: 'stack', stackDependencies: ['A'] },
        { id: 'C', type: 'stack' },
        { id: 'D', type: 'stack', stackDependencies: ['C'] },
      ]),
      expected: ['A', 'C', 'B', 'D'],
    },
    // With Assets
    {
      scenario: 'A -> a',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', assetDependencies: ['a'] },
        { id: 'a', type: 'asset' },
      ]),
      expected: ['a-build', 'a-publish', 'A'],
    },
    {
      scenario: 'A -> [a, B]',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', stackDependencies: ['B'], assetDependencies: ['a'] },
        { id: 'B', type: 'stack' },
        { id: 'a', type: 'asset' },
      ]),
      expected: ['B', 'a-build', 'a-publish', 'A'],
    },
    {
      scenario: 'A -> a, B -> b',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', assetDependencies: ['a'] },
        { id: 'B', type: 'stack', assetDependencies: ['b'] },
        { id: 'a', type: 'asset' },
        { id: 'b', type: 'asset' },
      ]),
      expected: ['a-build', 'b-build', 'a-publish', 'b-publish', 'A', 'B'],
    },
    {
      scenario: 'A, B -> b -> A',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack' },
        { id: 'B', type: 'stack', assetDependencies: ['b'] },
        { id: 'b', type: 'asset', stackDependencies: ['A'] },
      ]),
      expected: ['A', 'b-build', 'b-publish', 'B'],
    },

    // Concurrency 2
    { scenario: 'No Stacks', concurrency: 2, toDeploy: [], expected: [] },
    { scenario: 'A', concurrency: 2, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }]), expected: ['A'] },
    { scenario: 'A, B', concurrency: 2, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack' }]), expected: ['A', 'B'] },
    { scenario: 'A -> B', concurrency: 2, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack', stackDependencies: ['A'] }]), expected: ['A', 'B'] },
    { scenario: '[unsorted] A -> B', concurrency: 2, toDeploy: createArtifacts([{ id: 'B', type: 'stack', stackDependencies: ['A'] }, { id: 'A', type: 'stack' }]), expected: ['A', 'B'] },
    { scenario: 'A -> B -> C', concurrency: 2, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack', stackDependencies: ['A'] }, { id: 'C', type: 'stack', stackDependencies: ['B'] }]), expected: ['A', 'B', 'C'] },
    { scenario: 'A -> B, A -> C', concurrency: 2, toDeploy: createArtifacts([{ id: 'A', type: 'stack' }, { id: 'B', type: 'stack', stackDependencies: ['A'] }, { id: 'C', type: 'stack', stackDependencies: ['A'] }]), expected: ['A', 'B', 'C'] },
    {
      scenario: 'A, B',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', name: SLOW },
        { id: 'B', type: 'stack' },
      ]),
      expected: ['B', 'A'],
    },
    {
      scenario: 'A -> B, C -> D',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack' },
        { id: 'B', type: 'stack', stackDependencies: ['A'] },
        { id: 'C', type: 'stack' },
        { id: 'D', type: 'stack', stackDependencies: ['C'] },
      ]),
      expected: ['A', 'C', 'B', 'D'],
    },
    {
      scenario: 'A (slow) -> B, C -> D',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', name: SLOW },
        { id: 'B', type: 'stack', stackDependencies: ['A'] },
        { id: 'C', type: 'stack' },
        { id: 'D', type: 'stack', stackDependencies: ['C'] },
      ]),
      expected: ['C', 'D', 'A', 'B'],
    },
    {
      scenario: 'A -> B, A not selected',
      concurrency: 1,
      toDeploy: createArtifacts([
        { id: 'B', type: 'stack', stackDependencies: ['A'] },
      ]),
      expected: ['B'],
    },
    // With Assets
    {
      scenario: 'A -> a',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', assetDependencies: ['a'] },
        { id: 'a', type: 'asset' },
      ]),
      expected: ['a-build', 'a-publish', 'A'],
    },
    {
      scenario: 'A -> [a, B]',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', stackDependencies: ['B'], assetDependencies: ['a'] },
        { id: 'B', type: 'stack', name: SLOW },
        { id: 'a', type: 'asset' },
      ]),
      expected: ['a-build', 'a-publish', 'B', 'A'],
    },
    {
      scenario: 'A -> a, B -> b',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', assetDependencies: ['a'] },
        { id: 'B', type: 'stack', assetDependencies: ['b'] },
        { id: 'a', type: 'asset' },
        { id: 'b', type: 'asset' },
      ]),
      expected: ['a-build', 'b-build', 'a-publish', 'b-publish', 'A', 'B'],
    },
    {
      scenario: 'A, B -> b -> A',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack' },
        { id: 'B', type: 'stack', assetDependencies: ['b'] },
        { id: 'b', type: 'asset', stackDependencies: ['A'] },
      ]),
      expected: ['A', 'b-build', 'b-publish', 'B'],
    },
    {
      scenario: 'A, B -> [b, c], b -> A',
      concurrency: 2,
      toDeploy: createArtifacts([
        { id: 'A', type: 'stack', name: SLOW },
        { id: 'B', type: 'stack', assetDependencies: ['b', 'c'] },
        { id: 'b', type: 'asset', stackDependencies: ['A'] },
        { id: 'c', type: 'asset' },
      ]),
      expected: ['c-build', 'c-publish', 'A', 'b-build', 'b-publish', 'B'],
    },
  ])('Success - Concurrency: $concurrency - $scenario', async ({ concurrency, expected, toDeploy }) => {
    await expect(deployArtifacts(toDeploy as unknown as Stack[], { concurrency, deployStack, buildAsset, publishAsset })).resolves.toBeUndefined();

    expect(actionedAssets).toStrictEqual(expected);
  });

  // Failure
  // test.each([
  //   // Concurrency 1
  //   { scenario: 'A (error)', concurrency: 1, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [], displayName: 'A' }]), expectedError: 'A', expectedStacks: [] },
  //   { scenario: 'A (error), B', concurrency: 1, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [], displayName: 'A' }, { id: 'B', dependencies: [] }]), expectedError: 'A', expectedStacks: [] },
  //   { scenario: 'A, B (error)', concurrency: 1, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [] }, { id: 'B', dependencies: [], displayName: 'B' }]), expectedError: 'B', expectedStacks: ['A'] },
  //   { scenario: 'A (error) -> B', concurrency: 1, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [], displayName: 'A' }, { id: 'B', dependencies: [{ id: 'A' }] }]), expectedError: 'A', expectedStacks: [] },
  //   { scenario: '[unsorted] A (error) -> B', concurrency: 1, toDeploy: createStackArtifacts([{ id: 'B', dependencies: [{ id: 'A' }] }, { id: 'A', dependencies: [], displayName: 'A' }]), expectedError: 'A', expectedStacks: [] },
  //   {
  //     scenario: 'A (error) -> B, C -> D',
  //     concurrency: 1,
  //     toDeploy: createStackArtifacts([
  //       { id: 'A', dependencies: [], displayName: 'A' },
  //       { id: 'B', dependencies: [{ id: 'A' }] },
  //       { id: 'C', dependencies: [] },
  //       { id: 'D', dependencies: [{ id: 'C' }] },
  //     ]),
  //     expectedError: 'A',
  //     expectedStacks: [],
  //   },
  //   {
  //     scenario: 'A -> B, C (error) -> D',
  //     concurrency: 1,
  //     toDeploy: createStackArtifacts([
  //       { id: 'A', dependencies: [] },
  //       { id: 'B', dependencies: [{ id: 'A' }] },
  //       { id: 'C', dependencies: [], displayName: 'C', name: SLOW },
  //       { id: 'D', dependencies: [{ id: 'C' }] },
  //     ]),
  //     expectedError: 'C',
  //     expectedStacks: ['A'],
  //   },

  //   // Concurrency 2
  //   { scenario: 'A (error)', concurrency: 2, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [], displayName: 'A' }]), expectedError: 'A', expectedStacks: [] },
  //   { scenario: 'A (error), B', concurrency: 2, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [], displayName: 'A' }, { id: 'B', dependencies: [] }]), expectedError: 'A', expectedStacks: ['B'] },
  //   { scenario: 'A, B (error)', concurrency: 2, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [] }, { id: 'B', dependencies: [], displayName: 'B' }]), expectedError: 'B', expectedStacks: ['A'] },
  //   { scenario: 'A (error) -> B', concurrency: 2, toDeploy: createStackArtifacts([{ id: 'A', dependencies: [], displayName: 'A' }, { id: 'B', dependencies: [{ id: 'A' }] }]), expectedError: 'A', expectedStacks: [] },
  //   { scenario: '[unsorted] A (error) -> B', concurrency: 2, toDeploy: createStackArtifacts([{ id: 'B', dependencies: [{ id: 'A' }] }, { id: 'A', dependencies: [], displayName: 'A' }]), expectedError: 'A', expectedStacks: [] },
  //   {
  //     scenario: 'A (error) -> B, C -> D',
  //     concurrency: 2,
  //     toDeploy: createStackArtifacts([
  //       { id: 'A', dependencies: [], displayName: 'A' },
  //       { id: 'B', dependencies: [{ id: 'A' }] },
  //       { id: 'C', dependencies: [] },
  //       { id: 'D', dependencies: [{ id: 'C' }] },
  //     ]),
  //     expectedError: 'A',
  //     expectedStacks: ['C'],
  //   },
  //   {
  //     scenario: 'A -> B, C (error) -> D',
  //     concurrency: 2,
  //     toDeploy: createStackArtifacts([
  //       { id: 'A', dependencies: [] },
  //       { id: 'B', dependencies: [{ id: 'A' }] },
  //       { id: 'C', dependencies: [], displayName: 'C', name: SLOW },
  //       { id: 'D', dependencies: [{ id: 'C' }] },
  //     ]),
  //     expectedError: 'C',
  //     expectedStacks: ['A', 'B'],
  //   },
  // ])('Failure - Concurrency: $concurrency - $scenario', async ({ concurrency, expectedError, toDeploy, expectedStacks }) => {
  //   // eslint-disable-next-line max-len
  //   await expect(deployArtifacts(toDeploy as unknown as Stack[], { concurrency, deployStack, buildAsset, publishAsset })).rejects.toThrowError(expectedError);

  //   expect(deployedStacks).toStrictEqual(expectedStacks);
  // });

  // Success with Asset Artifacts
  // test.each([
  //   {
  //     scenario: 'A -> [a, B]',
  //     concurrency: 1,
  //     toDeploy: createArtifacts([
  //       { id: 'A', type: 'stack', stackDependencies: ['B'], assetDependencies: ['a'] },
  //       { id: 'B', type: 'stack' },
  //       { id: 'a', type: 'asset' },
  //     ]),
  //   },
  //   {
  //     scenario: 'A -> a, B -> b',
  //     concurrency: 1,
  //     toDeploy: [
  //       createStackArtifact({ id: 'A', dependencies: ['a'] }),
  //       createStackArtifact({ id: 'B', dependencies: ['b'] }),
  //       createAssetArtifact({ id: 'a', dependencies: [] }),
  //       createAssetArtifact({ id: 'b', dependencies: [] }),
  //     ],
  //   },
  //   {
  //     scenario: 'A, B -> b -> A',
  //     concurrency: 1,
  //     toDeploy: [
  //       createStackArtifact({ id: 'A', dependencies: [] }),
  //       createStackArtifact({ id: 'B', dependencies: ['b'] }),
  //       createAssetArtifact({ id: 'b', dependencies: ['A'] }),
  //     ],
  //   },
  // ])('Success - Concurrency: $concurrency - $scenario', async ({ concurrency, toDeploy, expectedStacks }) => {
  //   const asset = createAssetArtifact({ id: 'AssetA', dependencies: [] });
  //   const assetB = createAssetArtifact({ id: 'AssetB', dependencies: [] });
  //   const stack = createStackArtifact({ id: 'StackA', dependencies: [asset] });
  //   const stackB = createStackArtifact({ id: 'StackB', dependencies: [assetB, stack] });
  //   // eslint-disable-next-line max-len
  //   await expect(deployArtifacts([stack, asset, stackB, assetB] as Artifact[], { concurrency, deployStack, buildAsset, publishAsset })).resolves.toBeUndefined();

  //   expect(deployedStacks).toStrictEqual(['StackA', 'StackB']);
  //   expect(publishedAssets).toStrictEqual(['AssetA-publish', 'AssetB-publish']);
  //   expect(builtAssets).toStrictEqual(['AssetA-build', 'AssetB-build']);
  // });
});

interface TestArtifact {
  stackDependencies?: string[];
  assetDependencies?: string[];
  id: string;
  type: 'stack' | 'asset';
  name?: number;
}

function createArtifact(artifact: TestArtifact): Artifact {
  const stackDeps: Artifact[] = artifact.stackDependencies?.map((id) => createArtifact({ id, type: 'stack' })) ?? [];
  const assetDeps: Artifact[] = artifact.assetDependencies?.map((id) => createArtifact({ id, type: 'asset' })) ?? [];

  const art = {
    id: artifact.id,
    dependencies: stackDeps.concat(assetDeps),
    name: artifact.name,
  };
  if (artifact.type === 'stack') {
    return {
      ...art,
      [CLOUDFORMATION_STACK_ARTIFACT_SYM]: true,
    } as unknown as Stack;
  } else {
    return {
      ...art,
      [ASSET_MANIFEST_ARTIFACT_SYM]: true,
    } as unknown as Asset;
  }
}

function createArtifacts(artifacts: TestArtifact[]): Artifact[] {
  return artifacts.map((art) => createArtifact(art));
}
