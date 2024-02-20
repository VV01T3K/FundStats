const { exec } = require("child_process");

const command = `curl 'https://api-frontend.coinpaprika.com/ajax/coins/1?section=longterm&all=false&expand=longterm%2Cprice_stats&sort%5Bsort%5D=change_1y_chart&sort%5Bsortorder%5D=desc&tagID=&filters%5Bcoins%5D=true&filters%5Btokens%5D=true&currency=pln' \
  -H 'authority: api-frontend.coinpaprika.com' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: pl-PL,pl;q=0.9' \
  -H 'dnt: 1' \
  -H 'if-modified-since: Mon, 19 Feb 2024 18:31:01 GMT' \
  -H 'origin: https://coinpaprika.com' \
  -H 'referer: https://coinpaprika.com/' \
  -H 'sec-ch-ua: "Not A(Brand";v="99", "Brave";v="121", "Chromium";v="121"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'sec-gpc: 1' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' \
  --compressed`;

exec(command, (error, stdout, stderr) => {
    if (error) {
        console.error(`exec error: ${error}`);
        return;
    }
    console.log(stdout);
});
