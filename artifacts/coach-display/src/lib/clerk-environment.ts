export function classifyClerkEnvironment(publishableKey: string | undefined) {
  if (publishableKey?.startsWith('pk_live_')) return 'Production';
  if (publishableKey?.startsWith('pk_test_')) return 'Development';
  return 'Environment unavailable';
}