var request = require("request");
var socketio = require("socket.io");

var appPort = require("./network-info.json").backEndPort;
var io = socketio.listen(appPort);
console.log("Listening on " + appPort.toString());

io.on("connection", socket => {
    //when the access token is passed from the front-end server, begin visualization functions
    socket.on("accessToken", access_token => {
        var options = {
            url: "https://api.spotify.com/v1/me/player/currently-playing",
            headers: { Authorization: "Bearer " + access_token },
            json: true
        };
        var mainLoop = setInterval(() => {
            // use the access token to access the Spotify Web API
            request.get(options, function(error, response, body) {
                //if the access code is invalid, request a new access code from the front-end server
                if (response.statusCode === 401) {
                    clearInterval(mainLoop);
                    socket.emit("refreshAccessToken");
                    console.log("Invalid access token");
                    console.log("New access token requested");
                }
                //if there is no playback detected, do nothing (for now)
                else if (response.statusCode === 204) {
                    console.log("No playback detected");
                }
                //if everything checks out, print song info
                else if (response.statusCode === 200) {
                    console.log(
                        body.item.name + " by " + body.item.artists[0].name
                    );
                    console.log(body.progress_ms);
                }
                //if something weird happened, print response.
                else {
                    console.log("UNEXPECTED ERROR\n");
                    console.log(
                        "RESPONSE:\n" + JSON.stringify(response, null, " ")
                    );
                }
            });
        }, 500);
    });
});
