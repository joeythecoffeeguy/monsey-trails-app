export async function sessionBoundRequest(
  expectedIdentity: string | null,
  currentIdentity: () => string | null,
  getToken: () => Promise<string | null>,
) {
  if (!expectedIdentity || currentIdentity() !== expectedIdentity) {
    throw new Error('The signed-in account changed.');
  }
  const token = await getToken();
  if (!token || currentIdentity() !== expectedIdentity) {
    throw new Error('The signed-in account changed.');
  }
  return { headers: { Authorization: `Bearer ${token}` } };
}