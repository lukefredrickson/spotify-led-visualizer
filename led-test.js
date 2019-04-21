var ws281x = require("rpi-ws281x-native");
var NUM_LEDS = 60;
var pixelData = new Uint32Array(NUM_LEDS);

ws281x.init(NUM_LEDS);

var colors = [
    rgb2Int(255, 0, 0),
    rgb2Int(255, 255, 0),
    rgb2Int(0, 255, 255),
    rgb2Int(0, 0, 255),
    rgb2Int(255, 0, 255)
];

var loops = 0;
var c = 0;
var loop = setInterval(() => {
    if (loops > 20) {
        ws281x.reset();
        clearInterval(loop);
    }
    for (var i = 0; i < NUM_LEDS; i++) {
        pixelData[i] = colors[c];
    }
    if (c == colors.length - 1) {
        c = 0;
    } else {
        c++;
    }
    ws281x.render(pixelData);
    loops++;
}, 250);

function rgb2Int(r, g, b) {
    return ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff);
}
