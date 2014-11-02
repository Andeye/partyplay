var PlayMusic = require('playmusic');
var creds = require(process.env.HOME + '/.googlePlayCreds.json');

var https = require('https');
var spawn = require('child_process').spawn;

var express = require('express');
var bodyParser = require('body-parser');
var app = express();

app.get('/', function(req, res) {
    res.send('hello');
});

var player = null;

var playNext = function() {
    if(!queue.length) {
        console.log('end of queue, waiting for more songs');
        return;
    }

    if(player)
        return;

    // waiting to launch player...
    player = true;

    // play song
    nowPlaying = queue.shift();
    console.log('playing song: ' + nowPlaying.id);

    pm.getStreamUrl(nowPlaying.id, function(streamUrl) {
        player = spawn('mpg123', [ '-' ]);
        player.on('exit', function() {
            console.log('playback stopped');
            player = null;
            playNext();
        });
        /*
        player.stdout.on('data', function(data) {
            console.log('player stdout: ' + data);
        });
        player.stderr.on('data', function(data) {
            console.log('player stderr: ' + data);
        });
        */

        var req = https.request(streamUrl, function(res) {
            res.on('data', function(chunk) {
                player.stdin.write(chunk);
            });
            res.on('end', function() {
                player.stdin.end();
            });
        });
        req.end();
    });
};

var queue = [];
var nowPlaying;

var sortQueue = function() {
    queue.sort(function(a, b) {
        return (Object.keys(a.upVotes).length - Object.keys(a.downVotes).length) -
               (Object.keys(b.upVotes).length - Object.keys(b.downVotes).length);
    });
};

// find song from queue, if not found then create it
var searchQueue = function(songID) {
    for(var i = 0; i < queue.length; i++) {
        if(queue[i].id === songID)
            return queue[i];
    }

    return null;
};

var createSong = function(song) {
    song.upVotes = {};
    song.downVotes = {};
    queue.push(song);
    playNext();
    return song;
};

var voteSong = function(song, vote, userID) {
    // normalize vote to -1, 0, 1
    vote = parseInt(vote);

    if(vote)
        vote = vote / Math.abs(vote);
    else
        vote = 0;

    if(!vote) {
        delete(song.upVotes[userID]);
        delete(song.downVotes[userID]);
    } else if (vote > 0) {
        delete(song.downVotes[userID]);
        song.upVotes[userID] = true;
    } else if (vote < 0) {
        delete(song.upVotes[userID]);
        song.downVotes[userID] = true;
    }

    sortQueue();
};

app.post('/vote/:id', bodyParser.json(), function(req, res) {
    var userID = req.body.userID;
    var vote = req.body.vote;
    var songID = req.params.id;
    if(!userID || vote === undefined || !songID) {
        res.status(404).send('please provide both userID and vote in the body');
    }

    var queuedSong = searchQueue(songID);
    if(!queuedSong) {
        res.status(404).send('song not found');
    }

    voteSong(queuedSong, song.vote, userID);

    console.log('got vote ' + song.vote + ' for song: ' + queuedSong.id);
});

// get entire queue
app.get('/queue', function(req, res) {
    res.send(JSON.stringify(queue));
});

// queue song
app.post('/queue', bodyParser.json(), function(req, res) {
    var song = req.body.song;

    // check that required fields are provided
    if(!song.title || !song.id || !song.duration) {
        res.status(404).send('invalid song object');
    }

    // check that user has an id
    var userID = req.body.userID;
    if(!userID) {
        res.status(404).send('invalid userID');
    }

    // check if the song is already queued
    var queuedSong = searchQueue(song.id);
    if(!queuedSong)
        queuedSong = createSong(song);

    voteSong(queuedSong, +1, userID);

    console.log('added song to queue: ' + queuedSong.id);
    res.status(404).send('song added');
});

// search for song with given search terms
app.get('/search/:terms', function(req, res) {
    console.log('got search request: ' + req.params.terms);
    pm.search(req.params.terms, 10, function(data) {
        var songs = [];

        if(data.entries) {
            songs = data.entries.sort(function(a, b) {
                return a.score < b.score; // sort by score
            }).filter(function(entry) {
                return entry.type === '1'; // songs only, no albums/artists
            });

            for(var i = 0; i < songs.length; i++) {
                songs[i] = {
                    artist: songs[i].track.artist,
                    title: songs[i].track.title,
                    duration: songs[i].track.durationMillis,
                    id: songs[i].track.nid
                };
            }
        }

        res.send(JSON.stringify(songs));
    }, function(err) {
        console.log(err);
        res.status(404).send(err);
    });
});

app.listen(process.env.PORT || 8080);
console.log('listening on port ' + (process.env.PORT || 8080));

var pm = new PlayMusic();
pm.init(creds, function() {
    console.log('google play music initialized');
});
