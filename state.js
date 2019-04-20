module.exports = {
    state: {
        io: {
            socket: null
        },

        api: {
            currentlyPlaying:
                "https://api.spotify.com/v1/me/player/currently-playing",
            trackAnalysis: "https://api.spotify.com/v1/audio-analysis/",
            trackFeatures: "https://api.spotify.com/v1/audio-features/",
            seek: "https://api.spotify.com/v1/me/player/seek",
            headers: {},
            pingDelay: 1000
        },

        tokens: {
            accessToken: ""
        },

        visualizer: {
            /** Echo Nest interval types, for iteration brevity. */
            intervalTypes: ["tatums", "segments", "beats", "bars", "sections"],

            /** References to currently active intervals, per track progress. */
            activeIntervals: {
                tatums: {},
                segments: {},
                beats: {},
                bars: {},
                sections: {}
            },

            activeBeat: {},
            activeBeatIndex: 0,
            beatLoopRunning: false,
            terminateBeatLoop: false,
            beatSyncDelay: 100,

            /** Current track, track analysis, and track features. */
            currentlyPlaying: {},
            trackAnalysis: {},
            hasAnalysis: false,

            /** Timestamps & progress. */
            initialTrackProgress: 0,
            initialStart: 0,
            trackProgress: 0,

            /** Playing state. */
            active: false,
            initialized: false
        }
    }
};
