var app = require('./webServer'),
    config = require('./config'),
    fs = require('fs'),
    https = require('https'),

    UPDATES_PER_HOUR = 4,

    api = {
        base:'https://na.api.pvp.net/api/lol',
        key:config.apiKey
    },

    store = {
        champions:  [],
        games:      [],
        items:      [],
        players:    [],
        summoners:  config.summoners
    },


getAllRecentGames = function(callback) {
    var summonerIndex = 1;

    for(var i = 0; i < store.summoners.length; i++) {
        getJSON('/v1.3/game/by-summoner/' + store.summoners[i].id + '/recent', function(data) {
            saveGame(data.summonerId, data.games);

            if(++summonerIndex > store.summoners.length && typeof callback === 'function')
                callback();
        });
    };
},

getJSON = function(endpoint, options, callback) {
    var query = '?api_key=' + api.key,
        url = api.base;

    if(typeof options === 'function') {
        callback = options;
    } else {
        if('static' in options && options.static)
            url += '/static-data';

        if('params' in options)
            for(var key in options.params)
                query += '&' + key + '=' + options.params[key];
    };

    url += '/na' + endpoint + query;

    https.get(url, function(response) {
        var str = '';
        response.setEncoding('utf8');
        response.on('data', function(chunk) {
            str += chunk;
        });
        response.on('end', function() {
            callback(JSON.parse(str));
        });
    });
},

find = function(collectionName, id) {
    var collection = store[collectionName];
    for(var i = 0; i < collection.length; i++)
        if(collection[i].id === id)
            return collection[i];
    return null;
},

saveGame = function(summoner, rawGame) {
    // This method accepts an array of raw game data,
    // in which case it will call itself recursively.
    if(Array.isArray(rawGame)) {
        for(var i = 0; i < rawGame.length; i++)
            saveGame(summoner, rawGame[i]);
        return;
    };

    // Fixes unknown bug.
    if(!('fellowPlayers' in rawGame))
        return;

    // Add the owning player and any friends to the players collection.
    store.players.push({
        game:       rawGame.gameId,
        summoner:   summoner,
        champion:   rawGame.championId,
        kills:      rawGame.stats.championsKilled || 0,
        deaths:     rawGame.stats.numDeaths || 0,
        assists:    rawGame.stats.assists || 0,
        minions:    rawGame.stats.minionsKilled,
        gold:       rawGame.stats.goldEarned,
        wards:      rawGame.stats.wardPlaced,
        item0:      rawGame.stats.item0,
        item1:      rawGame.stats.item1,
        item2:      rawGame.stats.item2,
        item3:      rawGame.stats.item3,
        item4:      rawGame.stats.item4,
        item5:      rawGame.stats.item5,
        item6:      rawGame.stats.item6
    });

    // Check if the game has already been saved.
    if(find('games', rawGame.gameId) === null) {
        // Add the game data to the games collection.
        store.games.push({
            id:     rawGame.gameId,
            length: rawGame.stats.timePlayed,
            end:    rawGame.createDate,
            type:   rawGame.subType.replace('_', ' '),
            win:    rawGame.stats.win
        });
    };
};

// Register the route handlers.
app.get(['/', '/index.html'], function(request, response) {
    fs.readFile(__dirname+'/index.html', function(err, file) {
        var html = file.toString().replace('{{prerender json}}', JSON.stringify(store));
        app.respond(response, 200, {'Content-Type':'text/html'}, html);
    });
});


// Initialize the app.

// All the static data (champions and items)
// is retrieved once at startup.

getJSON('/v1.2/champion', { static: true }, function(response) {
    // Get all the champions (id and name).
    var champions = response.data;
    Object.keys(champions).forEach(function (name) {
        store.champions.push({
            id:     champions[name].id,
            name:   name
        });
    });

    // NOTE: Static requests do not count toward rate limit.
    getJSON('/v1.2/item', {static:true, params:{itemListData:'from,image,sanitizedDescription'}}, function(response) {
        var item = {};
        for(var id in response.data) {
            item = response.data[id];

            if('inStore' in item && item.inStore === false) continue;

            store.items.push({
                id:         item.id,
                description:item.sanitizedDescription,
                from:       ('from' in item) ? item.from.map(function(x) { return parseInt(x, 10); }) : [],
                image:      item.image,
                name:       item.name
            });
        };

        getAllRecentGames(function() {
            app.init(__dirname, 8081);

            updateInterval = setInterval(function() {
                store.games = [];
                store.players = [];
                getAllRecentGames();
            }, 1000*60*60/UPDATES_PER_HOUR);
        });
    });
});
