export const prerender = false;

export async function GET() {
    const data = await fetch("https://www.mbank.pl/api/sfi/funds.json");
    return new Response(data.body);
}
