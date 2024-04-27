export const prerender = false;

export async function GET() {
    const data = await fetch("https://www.mbank.pl/.includes/sfi/tab.inc.json");
    return new Response(data.body);
}
