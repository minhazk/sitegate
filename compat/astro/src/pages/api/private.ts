export function GET() {
  return Response.json({ private: true });
}

export async function POST({ request }: { request: Request }) {
  return new Response(await request.text());
}
