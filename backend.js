//Author: Luke Fredrickson
//Ping loop structure adapted and modified from https://github.com/zachwinter/kaleidosync

/** IMPORT STATE */
var state = require("./state").state;

/** IMPORTS */
var request = require("request");
var socketio = require("socket.io");
var ws281x = require("rpi-ws281x-native");

/** LED STRIP INITIALIZATION */
var NUM_LEDS = 60;
var pixelData = new Uint32Array(NUM_LEDS);

ws281x.init(NUM_LEDS);

process.on("SIGINT", function() {
    ws281x.reset();
    process.nextTick(function() {
        process.exit(0);
    });
});

/** SOCKET IO CONNECTION */
var appPort = require("./network-info.json").backEndPort;
var io = socketio.listen(appPort);
console.log("Listening on " + appPort.toString());

// front-end socket connection signal
io.on("connection", socket => {
    state.io.socket = socket;
    // when the access token is passed from the front-end server, begin visualization functions
    socket.on("accessToken", access_token => {
        //terminate any already running visualizer
        stopPingLoop(state);
        initialize(state, access_token);
    });
});

/**
 *  initializes the visualizer by setting access token and starting ping loop
 */
function initialize(state, access_token) {
    // update state with access token
    state.tokens.accessToken = access_token;
    state.api.headers = { Authorization: "Bearer " + access_token };
    // start the ping loop
    ping(state);
}

/**
 * request new access token from express server if required
 */
function refreshAccessToken(state) {
    console.log("Refreshing access token...");
    state.io.socket.emit("refreshAccessToken");
}

/**
 * ping the spotify API for the currently playing song after a delay specified in state
 */
function ping(state) {
    state.pingLoop = setTimeout(
        () => fetchCurrentlyPlaying(state),
        state.api.pingDelay
    );
}

/**
 * stops the ping loop, effectively stopping the visualizer until a new access token is passed
 */
function stopPingLoop(state) {
    if (state.pingLoop !== undefined) {
        clearTimeout(state.pingLoop);
        stopVisualizer(state);
        console.log("\n\t==========\n\tTERMINATED\n\t==========\n");
    }
}

/**
 * gets the currently playing song + track progress from spotify API
 */
function fetchCurrentlyPlaying(state) {
    // grab the current time
    var timestamp = Date.now();

    // request the currently playing song from spotify API
    request.get(
        {
            url: state.api.currentlyPlaying,
            headers: state.api.headers,
            json: true
        },
        (error, response, body) => {
            // access token is expired, we must request a new one
            if (response.statusCode === 401) {
                refreshAccessToken(state);
                return;
            }
            // no device is playing music
            else if (response.statusCode === 204) {
                console.log("\nNo playback detected");
                if (state.visualizer.active) {
                    stopVisualizer(state);
                }
                // keep listening in case playback resumes
                ping(state);
            }
            // no error, proceed
            else {
                // process the response
                processResponse(state, {
                    track: body.item,
                    playing: body.is_playing,
                    // account for time to call api in progress
                    progress: body.progress_ms + (Date.now() - timestamp)
                });
            }
        }
    );
}

/**
 * gets the song analysis (beat intervals, etc) for the current song from the spotify API
 */
function fetchTrackData(state, { track, progress }) {
    // fetch the current time
    var timestamp = Date.now();

    // request song analysis from spotify
    request.get(
        {
            url: state.api.trackAnalysis + track.id,
            headers: state.api.headers,
            json: true
        },
        (error, response, body) => {
            // access token is expired, we must request a new one
            if (response.statusCode === 401) {
                refreshAccessToken(state);
                return;
            }
            // no error, proceed
            else {
                var analysis = body;
                // if the track has no analysis data, don't visualize it
                if (
                    analysis === undefined ||
                    analysis["beats"] === undefined ||
                    analysis["beats"].length == 0
                ) {
                    state.visualizer.hasAnalysis = false;
                } else {
                    state.visualizer.hasAnalysis = true;
                    // adjust beat data for ease of use
                    normalizeIntervals(state, { track, analysis });
                }
                // account for time to call api in initial timestamp
                var initialTimestamp = Date.now() - (Date.now() - timestamp);
                syncTrackProgress(state, progress, initialTimestamp);
                // set the new currently playing song
                setCurrentlyPlaying(state, {
                    track,
                    analysis
                });
            }
        }
    );
}

/**
 * figure out what to do, according to state and track data
 */
function processResponse(state, { track, playing, progress }) {
    // check that the song we have is the currently playing song
    var songsInSync =
        JSON.stringify(state.visualizer.currentlyPlaying) ===
        JSON.stringify(track);

    // approximate progress vs api progress, and error between
    var progressStats = {
        client: state.visualizer.trackProgress,
        server: progress,
        error: state.visualizer.trackProgress - progress
    };

    // log the error between our approximate progress and the server progress
    console.log(`\nclient progress: ${progressStats.client}ms`);
    console.log(`server progress: ${progressStats.server}ms`);
    console.log(`Sync error: ${Math.round(progressStats.error)}ms\n`);

    // if nothing is playing, ping state
    if (track === null || track === undefined) {
        return ping(state);
    }

    // if something is playing, but visualizer isn't on
    if (playing && !state.visualizer.active) {
        // start the visualizer if the songs are synced
        if (songsInSync) {
            return startVisualizer(state);
        }
        // otherwise, get the data for the new track
        return fetchTrackData(state, { track, progress });
    }

    // if nothing is playing but the visualizer is active
    if (!playing && state.visualizer.active) {
        stopVisualizer(state);
    }

    // if the wrong song is playing
    if (playing && state.visualizer.active && !songsInSync) {
        // get the data for the new track
        stopVisualizer(state);
        return fetchTrackData(state, { track, progress });
    }

    // if the approximate track progress and the api track progress fall out of sync by more than 250ms
    // resync the progress and the beat loop
    if (
        playing &&
        state.visualizer.active &&
        songsInSync &&
        Math.abs(progressStats.error) > state.visualizer.syncOffsetThreshold
    ) {
        var initialTimestamp = Date.now();
        stopBeatLoop(state);
        syncTrackProgress(state, progress, initialTimestamp);
        syncBeats(state);
    }

    // keep the ping loop going
    ping(state);
}

/**
 * Sets the currently playing song and track analysis in state
 */
function setCurrentlyPlaying(state, { track, analysis }) {
    state.visualizer.currentlyPlaying = track;
    state.visualizer.trackAnalysis = analysis;

    startVisualizer(state);

    console.log(
        `Now playing: ${
            state.visualizer.currentlyPlaying.album.artists[0].name
        } – ${state.visualizer.currentlyPlaying.name}`
    );
}

/**
 * sets visualizer to active, syncs beats, and begins ping loop
 */
function startVisualizer(state) {
    console.log("\nVisualizer started");
    state.visualizer.active = true;
    syncBeats(state);
    ping(state);
}

/**
 * sets visualizer to inactive, terminates beat loop, and turns off led strip
 */
function stopVisualizer(state) {
    console.log("\nVisualizer stopped");
    state.visualizer.active = false;
    // stop the track progress loop if it's running
    stopTrackProgressLoop(state);
    // stop the beat loop if it's running
    stopBeatLoop(state);
    // black out the led strip
    for (var i = 0; i < NUM_LEDS; i++) {
        pixelData[i] = 0;
    }
    ws281x.render(pixelData);
}

/**
 * resets any track progress approximation loop currently running and begins a new loop
 */
function syncTrackProgress(state, initialProgress, initialTimestamp) {
    state.visualizer.initialTimestamp = initialTimestamp;
    // stop the track progress update loop
    stopTrackProgressLoop(state);
    // set the new approximate track progress
    setTrackProgress(state, initialProgress);
    // begin the track progress update loop
    startTrackProgressLoop(state);
}

/**
 * sets the approximation of track progress
 */
function setTrackProgress(state, initialProgress) {
    state.visualizer.initialTrackProgress = initialProgress;
}

/**
 * A setInterval loop which ticks approximate track progress
 */
function startTrackProgressLoop(state) {
    calculateTrackProgress(state);
    // calculate and set track progress on a specified tick rate
    state.visualizer.trackProgressLoop = setInterval(() => {
        calculateTrackProgress(state);
    }, state.visualizer.trackProgressTickRate);
}

/**
 * calculates current song progress with timestamp now and timestamp when song started playing
 */
function calculateTrackProgress(state) {
    state.visualizer.trackProgress =
        state.visualizer.initialTrackProgress +
        (Date.now() - state.visualizer.initialTimestamp);
}

/**
 * stops the approximate track progress loop
 */
function stopTrackProgressLoop(state) {
    if (state.visualizer.trackProgressLoop !== undefined) {
        clearTimeout(state.visualizer.trackProgressLoop);
    }
}

/**
 * Method borrowed from https://github.com/zachwinter/kaleidosync
 * Beat interval data is not present for entire duration of track data, and it is in seconds, not ms
 * We must make sure the first beat starts at 0, and the last ends at the end of the track
 * Then convert all time data to ms.
 */
function normalizeIntervals(state, { track, analysis }) {
    if (state.visualizer.hasAnalysis) {
        const beats = analysis["beats"];
        /** Ensure first interval of each type starts at zero. */
        beats[0].duration = beats[0].start + beats[0].duration;
        beats[0].start = 0;

        /** Ensure last interval of each type ends at the very end of the track. */
        beats[beats.length - 1].duration =
            track.duration_ms / 1000 - beats[beats.length - 1].start;

        /** Convert every time value to milliseconds for our later convenience. */
        beats.forEach(interval => {
            interval.start = interval.start * 1000;
            interval.duration = interval.duration * 1000;
        });
    }
}

/**
 * Manages the beat fire loop and detection of the active beat.
 */
function syncBeats(state) {
    if (state.visualizer.hasAnalysis) {
        // reset the active beat
        state.visualizer.activeBeat = {};
        state.visualizer.activeBeatIndex = 0;

        // grab state vars
        var trackProgress = state.visualizer.trackProgress;
        var beats = state.visualizer.trackAnalysis["beats"];

        // find and set the currently active beat
        for (var i = 0; i < beats.length - 2; i++) {
            if (
                trackProgress > beats[i].start &&
                trackProgress < beats[i + 1].start
            ) {
                state.visualizer.activeBeat = beats[i];
                state.visualizer.activeBeatIndex = i;
                break;
            }
        }
        // stage the beat
        stageBeat(state);
    }
}

/**
 * calculates the time until the next beat based on current beat duration and track progress
 */
function calculateTimeUntilNextBeat(state) {
    var activeBeatStart = state.visualizer.activeBeat.start;
    var activeBeatDuration = state.visualizer.activeBeat.duration;
    var trackProgress = state.visualizer.trackProgress;
    var timeUntilNextBeat =
        activeBeatDuration - (trackProgress - activeBeatStart);
    return timeUntilNextBeat;
}

/**
 * stage a beat to fire after a delay
 */
function stageBeat(state) {
    //set the timeout id to a variable in state for convenient loop cancellation.
    state.visualizer.beatLoop = setTimeout(
        () => fireBeat(state),
        calculateTimeUntilNextBeat(state)
    );
}

/**
 * stops the beat loop
 */
function stopBeatLoop(state) {
    if (state.visualizer.beatLoop !== undefined) {
        clearTimeout(state.visualizer.beatLoop);
    }
}

/**
 * Fires a beat on the LED strip.
 */
function fireBeat(state) {
    // log the beat to console if you want to
    /*
    console.log(
        `\nBEAT - ${Math.round(state.visualizer.activeBeat.start)}ms\n`
    );
    */

    // grab a random color from the options that is different from the previous color
    var randColor;
    do {
        randColor = Math.floor(
            Math.random() * Math.floor(state.visualizer.colors.length)
        );
    } while (randColor == state.visualizer.lastColor);
    //set the new previous color
    state.visualizer.lastColor = randColor;

    // set every LED on the strip to that color
    for (var i = 0; i < NUM_LEDS; i++) {
        pixelData[i] = state.visualizer.colors[randColor];
    }

    //render the LED strip
    ws281x.render(pixelData);

    // continue the beat loop by incrementing to the next beat
    incrementBeat(state);
    /*}*/
}

/**
 * sets the new active beat to the next beat in the array (if it exists)
 */
function incrementBeat(state) {
    var beats = state.visualizer.trackAnalysis["beats"];
    var lastBeatIndex = state.visualizer.activeBeatIndex;
    // if the last beat index is the last beat of the song, stop beat loop
    if (beats.length - 1 !== lastBeatIndex) {
        // stage the beat
        stageBeat(state);

        // update the active beat to be the next beat
        var nextBeat = beats[lastBeatIndex + 1];
        state.visualizer.activeBeat = nextBeat;
        state.visualizer.activeBeatIndex = lastBeatIndex + 1;
    }
}
