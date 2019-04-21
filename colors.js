var colors = [
    rgb2Int(255, 0, 0),
    rgb2Int(255, 127, 0),
    rgb2Int(255, 255, 0),
    rgb2Int(127, 255, 0),
    rgb2Int(0, 255, 0),
    rgb2Int(0, 255, 127),
    rgb2Int(0, 255, 255),
    rgb2Int(0, 127, 255),
    rgb2Int(0, 0, 255),
    rgb2Int(127, 0, 255),
    rgb2Int(255, 0, 255),
    rgb2Int(255, 0, 127)
];

//converts an r,g,b color to integer form
function rgb2Int(r, g, b) {
    return ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff);
}

colors.forEach(c => {
    console.log(`${c},`);
});
