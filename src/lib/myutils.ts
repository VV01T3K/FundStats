import { promises as fs } from "fs";
import path from "path";

export async function cacheImage(url: string, name: string): Promise<string> {
    const imagePath = path.resolve(`./public/cache/${name}.png`);

    try {
        await fs.access(imagePath);
    } catch {
        console.log("fetching image " + name);

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(imagePath, buffer);
    }

    return `/cache/${name}.png`;
}

export function getColorClass(value: number) {
    if (value < 0) {
        return "text-red-myred";
    } else if (value > 0) {
        return "text-green-400";
    } else {
        return "text-white";
    }
}
export function getHighlightClass(value: number, threshold: number) {
    if (value > threshold) {
        return "bg-blue-600 bg-opacity-20";
        // return "text-yellow-400";
    } else {
        return "";
    }
}
