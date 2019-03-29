var express = require("express"); // Express web server framework
var request = require("request"); // "Request" library
var cors = require("cors");
var querystring = require("querystring");
var cookieParser = require("cookie-parser");

var client_id = "35aff29158f344858037d41be2493582"; // Your client id
var client_secret = "772b8d700e10495590f046da6c975e78"; // Your secret
var redirect_uri = "http://localhost:8888/callback"; // Your redirect uri

var stateKey = "spotify_auth_state";

var app = express();

app.use(express.static(__dirname + "/public"))
    .use(cors())
    .use(cookieParser());
