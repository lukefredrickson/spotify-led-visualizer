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
        if (state.running) {
            stopVisualizer(state);
            state.terminate = true;
            //wait for ping loop to die before re-initializing with new token
            setTimeout(
                () => initialize(state, access_token),
                2 * state.api.pingDelay
            );
        } else {
            initialize(state, access_token);
        }
    });
});

function initialize(state, access_token) {
    state.running = true;
    state.terminate = false;
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
    if (!state.terminate) {
        setTimeout(() => fetchCurrentlyPlaying(state), state.api.pingDelay);
    } else {
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
                // increment our approximation of the track progress by the API call delay
                if (state.visualizer.active) {
                    console.log(`\nrequest-delay: ${Date.now() - timestamp}`);
                    incrementTrackProgress(state, Date.now() - timestamp);
                }
                // process the response
                processResponse(state, {
                    track: body.item,
                    playing: body.is_playing,
                    progress: body.progress_ms
                });
            }
        }
    );
}

/**
 * figure out what to do, according to state and track data
 */
function processResponse(state, { track, playing, progress }) {
    // increment our approximation of the track progress by the ping rate
    if (state.visualizer.active) {
        incrementTrackProgress(state, state.api.pingDelay);
    }

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

    // log the error
    console.log(`client progress: ${progressStats.client}ms`);
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
            startVisualizer(state);
            return;
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
        // stop the visualizer
        stopVisualizer(state);
        // get the data for the new track
        return fetchTrackData(state, { track, progress });
    }

    // if the approximate track progress and the api track progress fall out of sync by more than 250ms
    // resync the progress and the beat loop
    if (
        playing &&
        state.visualizer.active &&
        songsInSync &&
        Math.abs(progressStats.error) > 150
    ) {
        setTrackProgress(state, progress);
        state.visualizer.terminateBeatLoop = true;
        syncBeats(state);
    }

    // keep the ping loop going
    ping(state);
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
                // set the new approximate track progress
                setTrackProgress(state, progress + (Date.now() - timestamp));
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
 * Sets the currently playing song and track analysis in state
 */
function setCurrentlyPlaying(state, { track, analysis }) {
    stopVisualizer(state);

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
 * sets the approximation of track progress
 */
function setTrackProgress(state, progress) {
    state.visualizer.trackProgress = progress;
}

/**
 * increments the approximation of track progress
 */
function incrementTrackProgress(state, progressIncrement) {
    state.visualizer.trackProgress += progressIncrement;
}

/**
 * sets visualizer to active, syncs beats, and begins ping loop
 */
function startVisualizer(state) {
    console.log("Visualizer started");
    state.visualizer.active = true;
    syncBeats(state);
    ping(state);
}

/**
 * sets visualizer to inactive, terminates beat loop, and turns off led strip
 */
function stopVisualizer(state) {
    console.log("Visualizer stopped");
    state.visualizer.active = false;
    // stop the beat loop if it's running
    if (state.visualizer.beatLoopRunning) {
        state.visualizer.terminateBeatLoop = true;
    }
    // black out the led strip
    for (var i = 0; i < NUM_LEDS; i++) {
        pixelData[i] = 0;
    }
    ws281x.render(pixelData);
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
    console.log("\n\tsyncBeats()");
    if (state.visualizer.hasAnalysis) {
        // if there is a call to terminate the beat loop and the beat loop is stopped, flag the loop as terminated
        if (
            state.visualizer.terminateBeatLoop &&
            !state.visualizer.beatLoopRunning
        ) {
            state.visualizer.terminateBeatLoop = false;
            // if the visualizer is currently active, resume the beat loop
            if (state.visualizer.active === true) {
                syncBeats(state);
            }
            return;
        }
        // if there is a currently running beat loop, terminate the loop and wait for it to stop
        else if (state.visualizer.beatLoopRunning) {
            state.visualizer.terminateBeatLoop = true;
            setTimeout(() => syncBeats(state), state.beatSyncWait);
        }
        // if there is no running loop and no call to terminate the loop, sync the beats and start the loop
        else {
            //console.log("\nSyncing Beats");

            state.visualizer.activeBeat = {};
            state.visualizer.activeBeatIndex = 0;
            // find and set the currently active beat
            var trackProgress = state.visualizer.trackProgress;
            var beats = state.visualizer.trackAnalysis["beats"];
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
            // if no active beat found, attempt to sync again
            if (state.visualizer.activeBeat === {}) {
                setTimeout(() => syncBeats(state), state.beatSyncWait);
            }
            // if the beat was found, stage the initial beat
            else {
                var activeBeatStart = state.visualizer.activeBeat.start;
                var activeBeatDuration = state.visualizer.activeBeat.duration;
                var timeUntilNextBeat =
                    activeBeatDuration - (trackProgress - activeBeatStart);
                // don't stage a beat if it has passed already, resync instead
                if (timeUntilNextBeat <= 0) {
                    setTimeout(() => syncBeats(state), state.beatSyncWait);
                }
                state.visualizer.beatLoopRunning = true;
                stageBeat(state, timeUntilNextBeat);
            }
        }
    }
}

/**
 * sets the new active beat to the next beat in the array (if it exists)
 */
function incrementBeat(state) {
    var beats = state.visualizer.trackAnalysis["beats"];
    var lastBeatIndex = state.visualizer.activeBeatIndex;
    // if the last beat index is the last beat of the song, stop beat loop
    if (beats.length - 1 === lastBeatIndex) {
        state.visualizer.beatLoopRunning = false;
    }
    // otherwise increment the beat by one
    else {
        var nextBeat = beats[lastBeatIndex + 1];
        state.visualizer.activeBeat = nextBeat;
        state.visualizer.activeBeatIndex = lastBeatIndex + 1;
        stageBeat(state, nextBeat.duration);
    }
}

/**
 * stage a beat to fire after a delay
 */
function stageBeat(state, timeUntilNextBeat) {
    setTimeout(() => fireBeat(state), timeUntilNextBeat);
}

/**
 * Fires a beat on the LED strip.
 */
function fireBeat(state) {
    // don't increment the beat if there is a call to terminate the loop
    if (state.visualizer.terminateBeatLoop) {
        state.visualizer.beatLoopRunning = false;
    } else {
        // log the beat to console if you want to
        console.log(
            `\nBEAT - ${Math.round(state.visualizer.activeBeat.start)}ms\n`
        );

        // grab a random color from the options that is different from the previous color
        var randColor;
        do {
            randColor = Math.floor(
                Math.random() * Math.floor(state.visualizer.colors.length)
            );
        } while (randColor == state.visualizer.lastColor);
        state.visualizer.lastColor = randColor;

        // set every LED on the strip to that color
        for (var i = 0; i < NUM_LEDS; i++) {
            pixelData[i] = state.visualizer.colors[randColor];
        }

        //render the LED strip
        ws281x.render(pixelData);

        // continue the beat loop by incrementing to the next beat
        incrementBeat(state);
    }
}
