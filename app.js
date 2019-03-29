var express = require("express");
var request = require("request");
var cors = require("cors");
var querystring = require("query-string");
var cookieParser = require("cookie-parser");
var crypto = require("crypto");
var io = require("socket.io-client");

//Serves a front end app
var appPort = 8888;
var app = express();
app.use(express.static(__dirname + "/public"))
    .use(cors())
    .use(cookieParser());

//spotify api information
var client_id = "35aff29158f344858037d41be2493582";
var client_secret = require("./keys.json").spotify_client_secret;
var redirect_uri = "http://localhost:8888/callback";

//key for auth state cookie
var stateKey = "spotify_auth_state";

//ROUTES
app.get("/login", function(req, res) {
    var state = crypto.randomBytes(16).toString("hex");
    res.cookie(stateKey, state);

    // your application requests authorization
    var scope = "user-read-currently-playing";

    // whether the user must reauthorize upon every login
    var showDialog = true;

    res.redirect(
        "https://accounts.spotify.com/authorize?" +
            querystring.stringify({
                response_type: "code",
                client_id: client_id,
                scope: scope,
                redirect_uri: redirect_uri,
                state: state,
                show_dialog: showDialog
            })
    );
});

app.get("/callback", function(req, res) {
    // your application requests refresh and access tokens
    // after checking the state parameter

    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect(
            "/#" +
                querystring.stringify({
                    error: "state_mismatch"
                })
        );
    } else {
        res.clearCookie(stateKey);
        var authOptions = {
            url: "https://accounts.spotify.com/api/token",
            form: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: "authorization_code"
            },
            headers: {
                Authorization:
                    "Basic " +
                    Buffer.from(client_id + ":" + client_secret).toString(
                        "base64"
                    )
            },
            json: true
        };

        request.post(authOptions, function(error, response, body) {
            if (!error && response.statusCode === 200) {
                var access_token = body.access_token,
                    refresh_token = body.refresh_token;

                var options = {
                    url:
                        "https://api.spotify.com/v1/me/player/currently-playing",
                    headers: { Authorization: "Bearer " + access_token },
                    json: true
                };

                // use the access token to access the Spotify Web API
                /*request.get(options, function(error, response, body) {
                    console.log(body);
                });*/

                res.redirect(
                    "/#" +
                        querystring.stringify({
                            access_token: access_token,
                            refresh_token: refresh_token
                        })
                );
                console.log(access_token);

                var socket = io.connect("http://localhost:3000/", {
                    reconnection: true
                });
                socket.on("connect", function() {
                    console.log("connected to localhost:3000");
                    socket.emit("accessToken", access_token);
                });
            } else {
                res.redirect(
                    "/#" +
                        querystring.stringify({
                            error: "invalid_token"
                        })
                );
            }
        });
    }
});

app.get("/refresh_token", function(req, res) {
    // requesting access token from refresh token
    var refresh_token = req.query.refresh_token;
    var authOptions = {
        url: "https://accounts.spotify.com/api/token",
        headers: {
            Authorization:
                "Basic " +
                Buffer.from(client_id + ":" + client_secret).toString("base64")
        },
        form: {
            grant_type: "refresh_token",
            refresh_token: refresh_token
        },
        json: true
    };

    request.post(authOptions, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var access_token = body.access_token;
            res.send({
                access_token: access_token
            });
        }
    });
});

console.log("Listening on " + appPort.toString());
app.listen(appPort);
