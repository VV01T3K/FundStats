export const prerender = false;

export async function GET() {
    const data = await fetch("https://api.coinmarketcap.com/aggr/v3/web/homepage");
    return new Response(data.body);
}
