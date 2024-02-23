export function getColorClass(value: number) {
    if (value < 0) {
        return "text-red-600";
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
