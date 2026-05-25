bun install
bunx @astrojs/upgrade

<!-- in devcontainer -->
bunx --bun astro dev --host 
<!-- in normal setup -->
bunx --bun astro dev

bunx --bun astro build

<!-- bun add -d @types/bun -->
<!-- bun i @vercel/speed-insights -->
<!-- bun i @vercel/analytics -->

bun i -D @iconify-json/mdi

line-md--upload-loop

https://tailwindui.com/components
https://panda-css.com/
https://stylexjs.com/

const imagePath = `Images/${coin.symbol}.jpg`;
cacheImage(
`https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
`./src/${imagePath}`
);
