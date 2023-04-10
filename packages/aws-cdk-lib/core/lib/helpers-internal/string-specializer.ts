import { Stack } from '../stack';
import * as cxapi from '../../../cx-api';
import { Token } from '../token';
import { Aws } from '../cfn-pseudo';

/**
 * A "replace-all" function that doesn't require us escaping a literal string to a regex
 */
function replaceAll(s: string, search: string, replace: string) {
  return s.split(search).join(replace);
}

export class StringSpecializer {
  constructor(private readonly stack: Stack, private readonly qualifier: string) {
  }

  /**
   * Function to replace placeholders in the input string as much as possible
   *
   * We replace:
   * - ${Qualifier}: always
   * - ${AWS::AccountId}, ${AWS::Region}: only if we have the actual values available
   * - ${AWS::Partition}: never, since we never have the actual partition value.
   */
  public specialize(s: string): string {
    s = replaceAll(s, '${Qualifier}', this.qualifier);
    return cxapi.EnvironmentPlaceholders.replace(s, {
      region: resolvedOr(this.stack.region, cxapi.EnvironmentPlaceholders.CURRENT_REGION),
      accountId: resolvedOr(this.stack.account, cxapi.EnvironmentPlaceholders.CURRENT_ACCOUNT),
      partition: cxapi.EnvironmentPlaceholders.CURRENT_PARTITION,
    });
  }

  /**
   * Specialize only the qualifier
   */
  public qualifierOnly(s: string): string {
    return replaceAll(s, '${Qualifier}', this.qualifier);
  }
}

/**
 * Return the given value if resolved or fall back to a default
 */
export function resolvedOr<A>(x: string, def: A): string | A {
  return Token.isUnresolved(x) ? def : x;
}

const ASSET_TOKENS = ['${AWS::Partition}', '${AWS::Region}', '${AWS::AccountId}'];
const CFN_TOKENS = [Aws.PARTITION, Aws.REGION, Aws.ACCOUNT_ID];

/**
 * Replaces CloudFormation Tokens ('Aws.PARTITION') with corresponding
 * Asset Tokens ('${AWS::Partition}').
 */
export function translateCfnTokenToAssetToken(arn: string) {
  for (let i = 0; i < CFN_TOKENS.length; i++) {
    arn = replaceAll(arn, CFN_TOKENS[i], ASSET_TOKENS[i]);
  }
  return arn;
}

/**
 * Replaces Asset Tokens ('${AWS::Partition}') with corresponding
 * CloudFormation Tokens ('Aws.PARTITION').
 */
export function translateAssetTokenToCfnToken(arn: string) {
  for (let i = 0; i < ASSET_TOKENS.length; i++) {
    arn = replaceAll(arn, ASSET_TOKENS[i], CFN_TOKENS[i]);
  }
  return arn;
}