const io = require('socket.io')()
let r = require('request')
const cheerio = require('cheerio')
let fs = require('fs')

import { findPath, mapRooms, roomsMapped } from './modules/pathfinder'
import { Mover } from './modules/mover'
import { account } from './modules/account'

let rg_sess_id = null // to store our rg_sess_id
let j = r.jar() // setup the cookie jar for request
let server = 'sigil'
let server_id = 1

const rg_id_regex = /rg_sess_id=([A-Za-z0-9]+)\;/g // regex to extract the rg_sess_id
const headers = { // the UA header we send we making a request
    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36"
}

r = r.defaults({jar:j}) // set the cookie jar for request

account.setCookieJar(j)

const move = (character_id, destination, client) => {
    // request to get the characters current position
    r(`http://${server}.outwar.com/ajax_changeroomb.php?room=0&lastroom=0&suid=${character_id}&serverid=${server_id}`, (err, res, body) => {
        let json = JSON.parse(body)

        // set the characters current room
        let mover = new Mover()
        mover.setCookieJar(j)
        mover.setCurrentRoom(json.curRoom)
        mover.setRgSessId(rg_sess_id)
        mover.setServer(server, server_id)
        mover.setCharacterId(character_id)
        /*
        * find a path from the current room to the room requested
        * and then move them
        */
        findPath(json.curRoom, destination, mover.move.bind(mover), client)
    })
}

// client connected from the web browser
io.on('connection', (client) => {

    // received a map room request
    client.on('mapRooms', () => {
        client.emit('roomsMapped', roomsMapped())
        /*
        * If the rooms are already mapped, we don't want to map them again,
        * otherwise we map the rooms for pathfinding. Also updates status
        * messages for the client
        */
        if(!roomsMapped()) {
            mapRooms()
            client.emit('roomsMapped', roomsMapped())
        }
    })

    // start the character movement
    client.on('move', (data) => {
        let { room, accounts } = data
        accounts.map(character_id => {
            move(character_id, room, client);
        })
    })

    // login to outwar using an rg_sess_id cookie
    client.on('login', (session) => {
        // if an rg_sess_id isn't passed, don't try to login
        if(session != undefined) {
            let options = {
                url: `http://${server}.outwar.com/profile.php?rg_sess_id=${session}`,
                method: 'GET',
                headers: headers
            }

            // make a request to login
            r(options, function() {
                // grab our updated rg_sess_id from the cookie jar
                let session_cookie = j._jar.store.idx['outwar.com']['/'].rg_sess_id

                // got a cookie, the server is logged in
                if(session_cookie) {
                    rg_sess_id = rg_id_regex.exec(session_cookie)[1] // extract the rg_sess_id from cookie
                    account.setRgSessId(rg_sess_id)
                    client.emit('updateRgSessId', rg_sess_id) // update client side rg_sess_id
                }
            })
        }
    })

    /*
    * Checks if the client is already logged in.
    * Usually when the user refreshes the page
    */
    client.on('checkLogin', () => {
        client.emit('checkLogin', {logged_in: rg_sess_id, rg_sess_id})
    })

    client.on('checkMapping', () => {
        client.emit('roomsMapped', roomsMapped())
    })

    // grab the players list of accounts
    client.on('getAccounts', () => {
        account.getAccounts(client)
        console.log(rg_sess_id)
    })

    client.on('setServer', server => {
        server_id = (server == 'sigil') ? 1 : 2
        server = server

        account.setServer(server, server_id)
    })
})

const port = 8000
io.listen(port)