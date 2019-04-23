module.exports = {
    state: {
        pingLoop: undefined,

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
            syncOffsetThreshold: 100,

            beatLoop: undefined,
            activeBeat: {},
            activeBeatIndex: 0,

            //colors to cycle through
            colors: [
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
            ],
            //index of the last color, to avoid duplicates
            lastColor: -1,

            /** Current track, track analysis, and track features. */
            currentlyPlaying: {},
            trackAnalysis: {},
            hasAnalysis: false,

            /** Timestamps & progress. */
            trackProgressLoop: undefined,
            trackProgressTickRate: 5,
            initialTimestamp: 0,
            initialTrackProgress: 0,
            trackProgress: 0,

            /** Playing state. */
            active: false
        }
    }
};
