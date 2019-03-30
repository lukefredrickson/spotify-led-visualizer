//impored required libraries
var express = require("express");
var request = require("request");
var cors = require("cors");
var querystring = require("query-string");
var cookieParser = require("cookie-parser");
var crypto = require("crypto");
var socketio = require("socket.io-client");

//grab network config info from network-info.json
var networkInfo = require("./network-info.json");
var baseUrl = networkInfo.baseUrl;
var appPort = networkInfo.frontEndPort;
var backEndPort = networkInfo.backEndPort;

//initialize Express server using public dir and cors, cookie-parser middleware
var app = express();
app.use(express.static(__dirname + "/public"))
    .use(cors())
    .use(cookieParser());

//spotify api information
var client_id = "35aff29158f344858037d41be2493582";
var client_secret = require("./keys.json").spotify_client_secret;
var redirect_uri = baseUrl + ":" + appPort.toString() + "/callback";

//key for state ID cookie
var stateKey = "spotify_auth_state";

//ROUTES
//login page (redirects to spotify auth page)
app.get("/login", function(req, res) {
    //initialize random state ID and store in cookie
    var state = crypto.randomBytes(16).toString("hex");
    res.cookie(stateKey, state);

    // your application requests authorization
    var scope = "user-read-currently-playing";

    // whether the user must reauthorize upon every login
    var showDialog = true;

    //redirect to spotify authorization page
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

//callback from Spotify authorization page
app.get("/callback", function(req, res) {
    //get authorization code contained in Spotify's callback request
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    //check that state contained in Spotify's callback matches original request state
    //this prevents cross-site request forgery
    //if state doesn't match, redirect to error page
    if (state === null || state !== storedState) {
        res.redirect(
            "/#" +
                querystring.stringify({
                    error: "state_mismatch"
                })
        );
    }

    //if state matches, continue on!
    else {
        //clear the state cookie
        res.clearCookie(stateKey);
        //use authorization code, client id and client secret to get access token and refresh token from Spotify
        //access token allows API request for a specific user's Spotify information.
        //refresh token allows API request to get a new access token once original expires.
        var authOptions = {
            url: "https://accounts.spotify.com/api/token",
            form: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: "authorization_code"
            },
            headers: {
                //authorization header is encoded in base64
                Authorization:
                    "Basic " +
                    Buffer.from(client_id + ":" + client_secret).toString(
                        "base64"
                    )
            },
            json: true
        };

        //send http request to Spotify to get access token and refresh token
        request.post(authOptions, function(error, response, body) {
            if (!error && response.statusCode === 200) {
                //grab access token and refresh token from API response
                var access_token = body.access_token,
                    refresh_token = body.refresh_token;
                //redirect to main interface page
                res.redirect("/visualizer");

                /* ================================================
                    WebSocket communication between front-end and back-end server.
                    ================================================ */

                //connect to the back-end server via websockets
                var socket = socketio.connect(
                    baseUrl + ":" + backEndPort.toString() + "/",
                    {
                        reconnection: true
                    }
                );
                socket.on("connect", () => {
                    console.log("connected to back-end server");
                    socket.emit("accessToken", access_token);
                });

                socket.on("refreshAccessToken", () => {
                    var authOptions = {
                        url: "https://accounts.spotify.com/api/token",
                        headers: {
                            Authorization:
                                "Basic " +
                                Buffer.from(
                                    client_id + ":" + client_secret
                                ).toString("base64")
                        },
                        form: {
                            grant_type: "refresh_token",
                            refresh_token: refresh_token
                        },
                        json: true
                    };

                    request.post(authOptions, function(error, response, body) {
                        if (!error && response.statusCode === 200) {
                            var new_access_token = body.access_token;
                            socket.emit("accessToken", new_access_token);
                        }
                    });
                });
            }

            //if authorization code is rejected, redirect with invalid token error
            else {
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

app.listen(appPort);
console.log("Listening on " + appPort.toString());
