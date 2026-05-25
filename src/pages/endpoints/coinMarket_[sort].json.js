export const prerender = false;

export async function GET({ params }) {
    const options = {
        method: "GET",
        headers: {
            "sec-ch-ua": '"Not A(Brand";v="99", "Brave";v="121", "Chromium";v="121"',
            Accept: "application/json, text/plain, */*",
            Referer: "https://coinpaprika.com/",
            DNT: "1",
            "sec-ch-ua-mobile": "?0",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "sec-ch-ua-platform": '"Windows"',
        },
    };
    const url = `https://api-frontend.coinpaprika.com/ajax/coins/1?section=longterm&all=false&expand=longterm%2Cprice_stats&sort%5Bsort%5D=change_${params.sort}_chart&sort%5Bsortorder%5D=desc&tagID=&filters%5Bcoins%5D=true&filters%5Btokens%5D=true&currency=pln`;
    const response = await fetch(url, options);
    const data = await response.json();
    return new Response(JSON.stringify(data));
}
