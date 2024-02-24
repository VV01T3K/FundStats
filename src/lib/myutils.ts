import fs from "fs";

export async function cacheImage(url: string, imagePath: string) {
    if (!fs.existsSync(imagePath)) {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        await fs.promises.writeFile(imagePath, Buffer.from(buffer));
    }
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
