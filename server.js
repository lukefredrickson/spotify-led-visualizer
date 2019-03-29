var express = require("express");
var request = require("request");
var cors = require("cors");
var querystring = require("querystring");
var cookieParser = require("cookie-parser");

var clientId = "35aff29158f344858037d41be2493582"; // Your client id
var clientSecret = require("./keys.json").spotify_client_secret; // Your secret
var redirectUri = "http://localhost:8888/callback"; // Your redirect uri

var stateKey = "spotify_auth_state";

var app = express();

app.use(express.static(__dirname + "/public"))
    .use(cors())
    .use(cookieParser());
