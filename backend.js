var request = require("request");
var socketio = require("socket.io");
var state = require("./state").state;

var appPort = require("./network-info.json").backEndPort;
var io = socketio.listen(appPort);
console.log("Listening on " + appPort.toString());

//boolean to check whether visualizer is currently being used
var inUse = false;

var ws281x = require("rpi-ws281x-native");
var NUM_LEDS = 60;
ws281x.init(NUM_LEDS);

var pixelData = new Uint32Array(NUM_LEDS);
var colors = [
    16711680,
    16744192,
    16776960,
    8388352,
    65280,
    65407,
    65535,
    32767,
    255,
    8323327,
    16711935,
    16711807
];

process.on("SIGINT", function() {
    ws281x.reset();
    process.nextTick(function() {
        process.exit(0);
    });
});

io.on("connection", socket => {
    if (inUse) {
        //send an in use status back to the front-end server
        socket.emit("inUse");
    } else {
        inUse = true;
        socketClientId = socket.client.id;
        state.io.socket = socket;
        //when the access token is passed from the front-end server, begin visualization functions
        socket.on("accessToken", access_token => {
            // UPDATE STATE WITH ACCESS TOKEN
            state.tokens.accessToken = access_token;
            state.api.headers = { Authorization: "Bearer " + access_token };
            ping(state);
        });
    }
});

/** ping spotify for current track after delay */
function ping(state) {
    setTimeout(() => fetchCurrentlyPlaying(state), state.api.pingDelay);
}

function fetchCurrentlyPlaying(state) {
    var timestamp = Date.now();

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
            } else if (response.statusCode === 204) {
                console.log("\nNo playback detected");
                if (state.visualizer.active) {
                    stopVisualizer(state);
                }
                ping(state);
            }
            // no error, proceed
            else {
                if (state.visualizer.active) {
                    incrementTrackProgress(
                        state,
                        state.api.pingDelay + (Date.now() - timestamp)
                    );
                }
                processResponse(state, {
                    track: body.item,
                    playing: body.is_playing,
                    progress: body.progress_ms
                });
                /*
                try {
                    
                } catch (error) {
                    console.log("error: " + error);
                    console.log("response: " + JSON.stringify(response));
                    console.log("body: " + body);
                    return;
                }
                */
            }
        }
    );
}

function fetchTrackData(state, { track, progress }) {
    var timestamp = Date.now();

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
                    normalizeIntervals(state, { track, analysis });
                }
                //console.log(`has-analysis: ${state.visualizer.hasAnalysis}`);
                setTrackProgress(
                    state,
                    progress + (Date.now() - timestamp) + 5
                );
                setCurrentlyPlaying(state, {
                    track,
                    analysis,
                    progress: progress
                });
                //console.log(state.visualizer.trackAnalysis["beats"]);
            }
        }
    );
}

function processResponse(state, { track, playing, progress }) {
    console.log("\nPROCESSING");

    var songsInSync =
        JSON.stringify(state.visualizer.currentlyPlaying) ===
        JSON.stringify(track);

    var progressStats = {
        client: state.visualizer.trackProgress + state.api.pingDelay,
        server: progress,
        error: state.visualizer.trackProgress - progress
    };

    //console.log(`track: ${track.album.artists[0].name} – ${track.name}`);
    //console.log("is playing: " + playing);
    //console.log("client progress: " + state.visualizer.trackProgress);
    //console.log("server progress: " + JSON.stringify(progress));
    console.log(`Sync error: ${Math.round(progressStats.error)}ms`);

    if (track === null || track === undefined) {
        return ping(state);
    }

    if (playing && !state.visualizer.active) {
        if (songsInSync) {
            startVisualizer(state);
            return;
        }

        return fetchTrackData(state, { track, progress });
    }

    if (!playing && state.visualizer.active) {
        stopVisualizer(state);
    }

    if (playing && state.visualizer.active && !songsInSync) {
        stopVisualizer(state);
        return fetchTrackData(state, { track, progress });
    }

    if (
        playing &&
        state.visualizer.active &&
        songsInSync &&
        Math.abs(progressStats.error) > 250
    ) {
        setTrackProgress(state, progress);
        state.visualizer.terminateBeatLoop = true;
        syncBeats(state);
    }

    ping(state);
}

function refreshAccessToken(state) {
    console.log("emitting refresh request");
    state.io.socket.emit("refreshAccessToken");
    console.log("request emitted");
}

function setCurrentlyPlaying(state, { track, analysis, progress }) {
    //console.log("setting currently playing");

    stopVisualizer(state);

    state.visualizer.currentlyPlaying = track;
    state.visualizer.trackAnalysis = analysis;
    state.initialTrackProgress = progress;

    //console.log(state);

    startVisualizer(state);

    console.log(
        `Now playing: ${
            state.visualizer.currentlyPlaying.album.artists[0].name
        } – ${state.visualizer.currentlyPlaying.name}`
    );
}

function setTrackProgress(state, progress) {
    state.visualizer.trackProgress = progress;
}

function incrementTrackProgress(state, progressIncrement) {
    state.visualizer.trackProgress += progressIncrement;
}

function startVisualizer(state) {
    console.log("Visualizer started");
    state.visualizer.initialStart = Date.now();
    state.visualizer.initialized = true;
    state.visualizer.active = true;

    syncBeats(state);
    ping(state);
}

function stopVisualizer(state) {
    console.log("Visualizer stopped");
    state.visualizer.active = false;
    //stop the beat loop if it's running
    if (state.visualizer.beatLoopRunning) {
        state.visualizer.terminateBeatLoop = true;
    }

    for (var i = 0; i < NUM_LEDS; i++) {
        pixelData[i] = 0;
    }
    ws281x.render(pixelData);
}

function normalizeIntervals(state, { track, analysis }) {
    if (state.visualizer.hasAnalysis) {
        state.visualizer.intervalTypes.forEach(t => {
            const type = analysis[t];

            /** Ensure first interval of each type starts at zero. */
            type[0].duration = type[0].start + type[0].duration;
            type[0].start = 0;

            /** Ensure last interval of each type ends at the very end of the track. */
            type[type.length - 1].duration =
                track.duration_ms / 1000 - type[type.length - 1].start;

            /** Convert every time value to milliseconds for our later convenience. */
            type.forEach(interval => {
                interval.start = interval.start * 1000;
                interval.duration = interval.duration * 1000;
            });
        });
    }
}

function syncBeats(state) {
    if (state.visualizer.hasAnalysis) {
        //console.log(`\nterminate: ${state.visualizer.terminateBeatLoop}`);
        //console.log(`running: ${state.visualizer.beatLoopRunning}\n`);

        //if there is a call to terminate the beat loop and the beat loop is stopped, flag the loop as terminated
        if (
            state.visualizer.terminateBeatLoop &&
            !state.visualizer.beatLoopRunning
        ) {
            state.visualizer.terminateBeatLoop = false;
            //if the visualizer is currently active, sync the beats
            if (state.visualizer.active === true) {
                syncBeats(state);
            }
            return;
        }
        //if there is a currently running beat loop, terminate the loop and wait for it to stop
        else if (state.visualizer.beatLoopRunning) {
            state.visualizer.terminateBeatLoop = true;
            setTimeout(() => syncBeats(state), state.beatSyncDelay);
        }
        // if there is no running loop and no call to terminate the loop, sync the beats and start the loop
        else {
            var timestamp = Date.now();

            console.log("\nSYNCING");

            state.visualizer.activeBeat = {};
            state.visualizer.activeBeatIndex = 0;
            //find and set the currently active beat
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
            //if no active beat found, attempt to sync again
            if (state.visualizer.activeBeat === {}) {
                setTimeout(() => syncBeats(state), state.beatSyncDelay);
            }
            //if the beat was found, stage the initial beat
            else {
                var activeBeatStart = state.visualizer.activeBeat.start;
                var activeBeatDuration = state.visualizer.activeBeat.duration;
                //add a few ms for the time it took to find the active beat
                trackProgress = trackProgress + (Date.now() - timestamp);
                var timeUntilNextBeat =
                    activeBeatDuration - (trackProgress - activeBeatStart);
                //don't stage a beat if it has passed already, resync instead
                if (timeUntilNextBeat <= 0) {
                    setTimeout(() => syncBeats(state), state.beatSyncDelay);
                }
                state.visualizer.beatLoopRunning = true;
                stageBeat(state, timeUntilNextBeat);
            }
        }
    }
}

function incrementBeat(state) {
    var beats = state.visualizer.trackAnalysis["beats"];
    var lastBeatIndex = state.visualizer.activeBeatIndex;
    //if the last beat index is the last beat of the song, stop beat loop
    if (beats.length - 1 === lastBeatIndex) {
        state.visualizer.beatLoopRunning = false;
    }
    //otherwise increment the beat by one
    else {
        var nextBeat = beats[lastBeatIndex + 1];
        state.visualizer.activeBeat = nextBeat;
        state.visualizer.activeBeatIndex = lastBeatIndex + 1;
        stageBeat(state, nextBeat.duration);
    }
}

function stageBeat(state, timeUntilNextBeat) {
    setTimeout(() => fireBeat(state), timeUntilNextBeat);
}

function fireBeat(state) {
    //don't increment the beat if there is a call to terminate the loop
    if (state.visualizer.terminateBeatLoop) {
        state.visualizer.beatLoopRunning = false;
    } else {
        /*console.log(
            "\nBEAT - " + Math.round(state.visualizer.activeBeat.start) + "ms\n"
        );*/
        var randColor = Math.floor(Math.random() * Math.floor(colors.length));
        for (var i = 0; i < NUM_LEDS; i++) {
            pixelData[i] = colors[randColor];
        }
        ws281x.render(pixelData);
        incrementBeat(state);
    }
}
