var request = require("request");

var appPort = 3000;
var io = require("socket.io").listen(appPort);
io.on("connection", function(socket) {
    console.log("connected:", socket.client.id);
    socket.on("accessToken", data => {
        console.log("access_token:", data);
        requestTrackInfo(data);
    });
});
console.log("Listening on " + appPort.toString());

var requestTrackInfo = access_token => {
    var options = {
        url: "https://api.spotify.com/v1/me/player/currently-playing",
        headers: { Authorization: "Bearer " + access_token },
        json: true
    };
    setInterval(() => {
        // use the access token to access the Spotify Web API
        request.get(options, function(error, response, body) {
            console.log(body.item.name + " by " + body.item.artists[0].name);
            console.log(body.progress_ms);
        });
    }, 500);
};
