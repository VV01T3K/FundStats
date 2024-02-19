export const prerender = false;

import { Database } from "bun:sqlite";

export async function GET() {
    let number = Math.random();
    // const data = `It was the best of times, it was the worst of times.`;
    // await Bun.write("output.txt", data);
    return new Response(
        JSON.stringify({
            number,
            message: `Here's a random number: ${number}`,
        })
    );
}
