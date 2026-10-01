export async function guardedWrite<Request, Hash>(
  simulate: (request: Request) => Promise<unknown>,
  write: (request: Request) => Promise<Hash>,
  request: Request,
): Promise<Hash> {
  await simulate(request);
  return write(request);
}
