// What people say to Dayspring's everyday commands without AI (lib/commands), and what each must be understood as.
// Written by hand, one group per line:   intent ~ {details that must match} ~ phrase | phrase | …
// The details are a partial match (only what's written is checked). "none" means lib/commands must NOT take it (the older
// skills and the intent engine answer those). Dates are for the test clock: Monday 28 September 2026, 2:30 p.m.
// scripts/test-intents.mjs runs it, and also each phrase with "hey dayspring" in front and "please" after.
import "./guard-data.mjs";   // first: tests never write to the real data folder
export const NOW = new Date(2026, 8, 28, 14, 30);
export const LAST = { kind: "block", id: "golden", title: "Dentist" };
export const COMMANDS_GOLDEN = String.raw`
close ~ {"args":{"kind":"thanks"}} ~ thanks | thank you | thank you so much | thanks a lot | thanks dayspring | thank you very much | okay thanks | ok thank you | cool thanks | perfect thanks | perfect, thanks | great thanks | awesome thanks | thanks again | much appreciated | appreciate it | cheers | thanks so much | thank ya | many thanks | thanks for the help | thank you for setting that up | thanks for everything | thanks for helping me
close ~ {"args":{"kind":"done"}} ~ that's all | that's it | that'll be all | that will be all | nothing else | nothing more | no that's fine | no that's it | no that's all | I'm good | all good | all set | I'm all set | we're done | we are done | done for now | that's all for now | that is all | no thanks | nope that's it | that works | sounds good | that's perfect | that should do it | stop listening for now | you can stop listening | that's everything | okay that's all | alright that's it | no thank you | i'm done | that's enough | that is it for now
close ~ {"args":{"kind":"bye"}} ~ goodbye | bye | bye bye | see you | see you later | see ya | later | talk to you later | catch you later | bye for now | see you tomorrow | take care | have a good day | later dayspring | peace out | good bye | see you soon
close ~ {"args":{"kind":"night"}} ~ good night | goodnight | night night | sleep well | sweet dreams | have a good night | good night dayspring | okay good night | thanks good night
close ~ {"args":{"kind":"nevermind"}} ~ never mind | nevermind | forget it | forget about it | okay never mind
pass ~ {"closing":"thanks"} ~ set a timer for 5 minutes thanks | set a timer for 5 minutes, thank you | what time is it thanks | what's the weather, thanks | tell me a joke thank you | add milk to my shopping list thanks | play some music thanks | how long is left on the pasta thanks | what's 12 times 14 thanks | open spotify thanks
pass ~ {"closing":"done"} ~ set a timer for 10 minutes that's all | what's on tomorrow, that's it | read john 3:16, that's all | how's the weather that's all | flip a coin that's it
pass ~ {"closing":"bye"} ~ set a timer for 3 minutes bye | what's next, goodbye | play some jazz, bye
setting.set ~ {"args":{"id":"volume","value":40},"closing":"thanks"} ~ set the volume to 40 thanks | set the volume to 40, thank you
alarm.create ~ {"args":{"hm":"07:00"},"closing":"thanks"} ~ set an alarm for 7am thanks | set an alarm for 7 am, thanks so much
pass ~ {"lead":"thanks-then"} ~ thanks for the reminder, now set a timer for 10 minutes | thank you, and what time is it | thanks, now tell me a joke | thanks for that, can you play some music | okay thanks, now what's on tomorrow
timer.cancel ~ {"args":{"ref":""}} ~ never mind the timer, cancel it
timer.cancel ~ {"args":{"ref":"pasta"}} ~ never mind the pasta timer, just cancel it
timer.cancel ~ {"args":{"ref":""}} ~ cancel the timer | stop the timer | kill the timer | turn off the timer | delete the timer | get rid of the timer
timer.cancel ~ {"args":{"ref":"pasta"}} ~ cancel the pasta timer | stop the pasta timer | delete my pasta timer | remove the pasta timer
timer.cancel ~ {"args":{"ref":"all"}} ~ cancel all timers | cancel all the timers | delete all my timers | stop all timers | clear all timers
undo ~ {} ~ undo | undo that | undo it | undo the last change | put it back | put that back | change it back | set it back | revert that | take that back | go back to how it was | reverse that | no don't do that | don't do that
setting.set ~ {"args":{"id":"volume","value":40}} ~ set the volume to 40 | volume 40 | set your volume to 40 | set the voice volume to 40 | change the volume to 40 percent | make the volume 40 | set volume at 40 | put the volume at 40% | can you set the volume to forty | turn your volume to 40
setting.set ~ {"args":{"id":"volume","value":25}} ~ set the volume to twenty five | set the volume to 25 percent | volume twenty five
setting.adjust ~ {"args":{"id":"volume","delta":15}} ~ turn the volume up | turn up the volume | make the volume louder | increase the volume | raise the volume | turn your voice up | make your voice louder
setting.adjust ~ {"args":{"id":"volume","delta":-15}} ~ turn the volume down | turn down the volume | lower the volume | decrease the volume | make your voice quieter | make your voice softer
setting.adjust ~ {"args":{"id":"volume","delta":7.5}} ~ turn the volume up a little | make your voice a bit louder | turn the volume up a bit
setting.adjust ~ {"args":{"id":"volume","delta":10}} ~ turn the volume up by 10 | raise the volume by 10
setting.get ~ {"args":{"id":"volume"}} ~ what's the volume | what is the volume set to | what's your volume at | what's the volume right now | how loud is the volume
setting.set ~ {"args":{"id":"musicVolume","value":30}} ~ set the music volume to 30 | set music volume to 30 | music volume 30 | change the spotify volume to 30 | set the volume of the music to 30
setting.adjust ~ {"args":{"id":"musicVolume","delta":-15}} ~ turn the music down | turn the music volume down | make the music quieter | lower the music volume
setting.adjust ~ {"args":{"id":"musicVolume","delta":15}} ~ turn the music up | make the music louder | turn the music volume up
setting.set ~ {"args":{"id":"videoVolume","value":60}} ~ set the video volume to 60 | set the youtube volume to 60 | video volume 60
setting.set ~ {"args":{"id":"soundsVolume","value":50}} ~ set the chime volume to 50 | set the sound effects volume to 50 | set the sounds volume to 50
setting.adjust ~ {"args":{"id":"soundsVolume","delta":-15}} ~ turn the chimes down | make the chimes quieter | turn the notification sounds down
setting.set ~ {"args":{"id":"alarmVolume","value":70}} ~ set the alarm volume to 70 | alarm volume 70 | set the volume of my alarm to 70 | change the alarm volume to 70 percent
setting.adjust ~ {"args":{"id":"alarmVolume","delta":15}} ~ make the alarm louder | turn the alarm volume up
setting.set ~ {"args":{"id":"callVolume","value":50}} ~ set the call volume to 50 | call volume 50 | set the tune in volume to 50
setting.adjust ~ {"args":{"id":"speed","delta":0.08}} ~ talk faster | speak faster | talk quicker | make your speaking speed faster
setting.adjust ~ {"args":{"id":"speed","delta":0.04}} ~ talk a bit faster | talk a little faster | speak a little quicker
setting.adjust ~ {"args":{"id":"speed","delta":-0.08}} ~ talk slower | speak slower | make your talking speed slower
setting.reset ~ {"args":{"id":"speed"}} ~ set the speed to normal | reset your talking speed | set your speaking speed back to normal
setting.set ~ {"args":{"id":"detail","value":"simple"}} ~ give me short answers | set the detail to simple | use short answers | brief answers please | simpler answers
setting.set ~ {"args":{"id":"detail","value":"detailed"}} ~ give me detailed answers | set the detail level to detailed | longer answers | more detailed answers
setting.set ~ {"args":{"id":"detail","value":"normal"}} ~ normal answers | set the detail to normal
setting.set ~ {"args":{"id":"timeTone","value":false}} ~ turn off the time of day tone | disable the time of day tone | no more soothing mornings
setting.set ~ {"args":{"id":"timeTone","value":true}} ~ turn on the time of day tone | enable soothing mornings
setting.set ~ {"args":{"id":"mode","value":"chime"}} ~ set notifications to chime only | make notifications a chime only | notifications chime only | switch notifications to chimes
setting.set ~ {"args":{"id":"mode","value":"silent"}} ~ mute notifications | make notifications silent | turn off notifications | set notifications to silent | silence the notifications
setting.set ~ {"args":{"id":"mode","value":"voice"}} ~ turn on notifications | set notifications to spoken | turn notifications back on | make notifications spoken out loud
setting.set ~ {"args":{"id":"mode","value":"silent","minutes":60}} ~ mute notifications for an hour | silence notifications for 1 hour | make notifications silent for an hour
setting.set ~ {"args":{"id":"mode","value":"silent","until":"15:00"}} ~ mute notifications until 3 pm | make notifications silent until 3 pm
setting.get ~ {"args":{"id":"mode"}} ~ what are notifications set to | how are my notifications set | what is the notification mode
setting.set ~ {"args":{"id":"listenState","value":"quiet","until":"03:00"}} ~ switch to quiet mode until 3 | go quiet until 3 | turn on quiet mode until 3
setting.set ~ {"args":{"id":"listenState","value":"quiet","minutes":60}} ~ go quiet for an hour | be quiet for an hour | stay quiet for an hour | quiet mode for an hour
setting.set ~ {"args":{"id":"listenState","value":"quiet","until":"17:00"}} ~ be quiet until 5 pm | switch to quiet mode until 5 pm
setting.set ~ {"args":{"id":"listenState","value":"off"}} ~ turn listening off | set listening to off | switch listening off
setting.set ~ {"args":{"id":"listenState","value":"active"}} ~ turn listening back on | set listening to active | switch to active mode
setting.set ~ {"args":{"id":"overlayOn","value":false}} ~ turn off the notification cards | hide the pop ups | turn off the desktop notifications | disable the popups | no more pop ups
setting.set ~ {"args":{"id":"overlayOn","value":true}} ~ turn on the notification cards | show the pop ups | enable desktop notifications
setting.set ~ {"args":{"id":"overlaySeconds","value":15}} ~ show notification cards for 15 seconds | keep pop ups up for 15 seconds | set the notification card time to 15
setting.set ~ {"args":{"id":"alarmsWhenOff","value":false}} ~ turn off alarms when you're off | don't ring alarms while you are off
setting.set ~ {"args":{"id":"timersWhenQuiet","value":false}} ~ turn off timers when you're quiet | disable timers while you are quiet
setting.set ~ {"args":{"id":"speechEngine","value":"local"}} ~ set speech recognition to private | use the private speech recognition | switch speech recognition to this computer | use local speech recognition
setting.set ~ {"args":{"id":"speechEngine","value":"browser"}} ~ set speech recognition to browser | use the browser speech recognition
setting.set ~ {"args":{"id":"speechEngine","value":"auto"}} ~ set speech recognition to automatic | speech recognition auto
setting.set ~ {"args":{"id":"logMisses","value":false}} ~ stop logging the missed phrases | turn off missed phrases | don't keep phrases you didn't understand
setting.set ~ {"args":{"id":"alarm","value":true}} ~ turn on the morning alarm | enable the wake up alarm | turn on my morning alarm
setting.set ~ {"args":{"id":"alarm","value":false}} ~ turn off the morning alarm | disable my morning alarm | turn the morning alarm off
setting.get ~ {"args":{"id":"alarm"}} ~ is the morning alarm on | is my morning alarm turned on
setting.set ~ {"args":{"id":"alarmSnooze","value":10}} ~ set the snooze to 10 minutes | set my snooze to 10 | set the snooze length to 10 minutes | change the default snooze to 10 minutes
setting.adjust ~ {"args":{"id":"alarmSnooze","delta":1}} ~ make the snooze longer
setting.get ~ {"args":{"id":"alarmSnooze"}} ~ what's the snooze set to | how long is the snooze
setting.set ~ {"args":{"id":"chores","value":false}} ~ turn off chore reminders | no more chore suggestions | disable chore nudges | stop the chore reminders
setting.set ~ {"args":{"id":"chores","value":true}} ~ turn on chore reminders | enable chore suggestions
setting.set ~ {"args":{"id":"goals","value":false}} ~ turn off goal check ins | disable goal reminders
setting.set ~ {"args":{"id":"claudeAlerts","value":false}} ~ turn off claude alerts | disable claude code alerts
setting.set ~ {"args":{"id":"jokeOffersOn","value":false}} ~ turn off joke offers | disable joke offers
setting.set ~ {"args":{"id":"jokeOffers","value":2}} ~ set joke offers per day to 2 | set how many jokes a day to 2
setting.set ~ {"args":{"id":"clock24","value":true}} ~ use 24-hour time | use 24 hour time | switch to 24 hour time | turn on 24 hour time | use military time | 24 hour clock please | set the clock to 24 hour format | show 24 hour time
setting.set ~ {"args":{"id":"clock24","value":false}} ~ use 12-hour time | use 12 hour time | switch to 12 hour time | 12 hour time please | turn off 24 hour time | use am pm time
setting.get ~ {"args":{"id":"clock24"}} ~ what time format are you using | what's the time format set to | is 24 hour time on
setting.adjust ~ {"args":{"id":"uiScale","delta":10}} ~ make everything bigger | make the whole screen bigger | zoom in | increase the screen size | make everything larger
setting.adjust ~ {"args":{"id":"uiScale","delta":-10}} ~ make everything smaller | make the whole screen smaller | zoom out | decrease the screen size
setting.set ~ {"args":{"id":"uiScale","value":120}} ~ set the screen size to 120 percent | set the zoom to 120
setting.adjust ~ {"args":{"id":"textScale","delta":10}} ~ make the text bigger | bigger text | make the font bigger | increase the text size | make the words bigger | make the writing larger
setting.adjust ~ {"args":{"id":"textScale","delta":-10}} ~ make the text smaller | smaller text | make the font smaller | decrease the text size
setting.set ~ {"args":{"id":"textScale","value":120}} ~ set the text size to 120 percent | set the font size to 120 | text size 120
setting.reset ~ {"args":{"id":"textScale"}} ~ reset the text size | put the text size back to normal | text size back to default
setting.get ~ {"args":{"id":"textScale"}} ~ what's the text size | what is the text size set to
setting.adjust ~ {"args":{"id":"clockScale","delta":15}} ~ make the clock bigger | bigger clock | make the clock larger
setting.adjust ~ {"args":{"id":"clockScale","delta":-15}} ~ make the clock smaller | shrink the clock size
setting.adjust ~ {"args":{"id":"talkWidth","delta":5}} ~ make your panel wider | make the dayspring panel wider | wider talk panel | make the chat panel bigger
setting.adjust ~ {"args":{"id":"talkWidth","delta":-5}} ~ make your panel narrower | make the talk panel thinner | narrower chat panel
setting.adjust ~ {"args":{"id":"carousel","delta":20}} ~ slower slides | make the slides slower | slow down the slideshow | make the carousel slower
setting.adjust ~ {"args":{"id":"carousel","delta":-20}} ~ faster slides | make the slides faster | speed up the slideshow
setting.set ~ {"args":{"id":"carousel","value":0}} ~ stop rotating the slides | stop the slideshow from changing | freeze the slides
setting.set ~ {"args":{"id":"listRows","value":8}} ~ show 8 rows | show eight rows | set the rows to 8 | show 8 rows on the schedule | show only 8 rows
setting.set ~ {"args":{"id":"listRows","value":0}} ~ show all the rows | show all rows
setting.set ~ {"args":{"id":"layout","value":"one"}} ~ one column | use one column | switch to a single column | single column layout | set the layout to one column
setting.set ~ {"args":{"id":"layout","value":"two"}} ~ two columns | use two columns | set the layout to two columns
setting.set ~ {"args":{"id":"layout","value":"talkLeft"}} ~ dayspring panel on the left | put your panel on the left | move the chat panel to the left | panel on the left | put the talk panel on the left side
setting.set ~ {"args":{"id":"layout","value":"talkRight"}} ~ dayspring panel on the right | put your panel on the right | move the chat panel to the right
setting.set ~ {"args":{"id":"layout","value":"compact"}} ~ compact layout | use the compact layout | set the layout to compact
setting.set ~ {"args":{"id":"layout","value":"auto"}} ~ automatic layout | use the automatic layout | set the layout to auto
setting.get ~ {"args":{"id":"layout"}} ~ what layout is this | what's the layout set to
setting.set ~ {"args":{"id":"density","value":"compact"}} ~ make the spacing tighter | tighter spacing | set the spacing to compact | less space between things
setting.set ~ {"args":{"id":"density","value":"comfortable"}} ~ comfortable spacing | set the spacing to comfortable | make the spacing roomier
setting.set ~ {"args":{"id":"fit","value":"keep"}} ~ keep the proportions | keep the screen proportions
setting.set ~ {"args":{"id":"fit","value":"fill"}} ~ set the screen fit to fill | stretch to fill
setting.set ~ {"args":{"id":"uiMotion","value":"reduced"}} ~ turn on calmer motion | use calmer motion | turn on reduced motion | turn off animations | less motion please | reduce the screen motion | calm motion on
setting.set ~ {"args":{"id":"uiMotion","value":"normal"}} ~ turn off calmer motion | turn on animations | turn off reduced motion | normal screen motion
setting.set ~ {"args":{"id":"showClock","value":false}} ~ hide the clock | turn off the clock | stop showing the clock | don't show the clock | get rid of the clock
setting.set ~ {"args":{"id":"showClock","value":true}} ~ show the clock | bring back the clock | put the clock back | turn on the clock
setting.set ~ {"args":{"id":"showNowNext","value":false}} ~ hide now and next | hide the now card | turn off now and next
setting.set ~ {"args":{"id":"showNowNext","value":true}} ~ show now and next | bring back the now and next card
setting.set ~ {"args":{"id":"showPanel","value":false}} ~ hide the rotating panel | hide the big panel | turn off the main panel
setting.set ~ {"args":{"id":"showPanel","value":true}} ~ show the rotating panel | bring back the main panel
setting.set ~ {"args":{"id":"showExam","value":false}} ~ hide the exam card | hide the exam countdown | turn off the exam card
setting.set ~ {"args":{"id":"showCourses","value":false}} ~ hide the course rings | hide the study progress | turn off the course rings
setting.set ~ {"args":{"id":"showTranscript","value":true}} ~ show the transcript | show captions | turn on the transcript | turn on subtitles
setting.set ~ {"args":{"id":"showTranscript","value":false}} ~ hide the transcript | turn off captions | hide the subtitles
setting.set ~ {"args":{"id":"overscan","value":5}} ~ set the margin to 5 percent | set the screen margin to 5 | set the margins to 5% | set the border to 5 percent
setting.adjust ~ {"args":{"id":"overscan","delta":1.5}} ~ make the margins bigger | make the margin wider | bigger margins
setting.reset ~ {"args":{"id":"overscan"}} ~ reset the margin | reset the margins | put the margins back to default
setting.set ~ {"args":{"id":"marginTop","value":3}} ~ set the top margin to 3 | set the top edge to 3 percent
setting.set ~ {"args":{"id":"marginLeft","value":4}} ~ set the left margin to 4 | set the left border to 4 percent
setting.set ~ {"args":{"id":"night","value":"dim"}} ~ night mode dim | set night mode to dim | make night mode dim | dim night mode
setting.set ~ {"args":{"id":"night","value":"off"}} ~ turn off night mode | night mode off | disable night mode
setting.set ~ {"args":{"id":"night","value":"dark"}} ~ turn on night mode | night mode on | set night mode to dark
setting.get ~ {"args":{"id":"night"}} ~ is night mode on | what's night mode set to
setting.set ~ {"args":{"id":"miniOnTop","value":true}} ~ keep dayspring mini on top | keep mini on top | turn on always on top
setting.set ~ {"args":{"id":"weather","value":false}} ~ turn off the weather | hide the weather | disable the weather | turn the weather off | stop showing the weather | no more weather on the screen
setting.set ~ {"args":{"id":"weather","value":true}} ~ turn on the weather | turn the weather back on | enable the weather | start showing the weather
setting.set ~ {"args":{"id":"news","value":false}} ~ turn off the news | disable the news | turn off the news briefing
setting.set ~ {"args":{"id":"faith","value":true}} ~ turn on the faith features | enable the faith features
setting.set ~ {"args":{"id":"memoryVerses","value":true}} ~ turn on memory verses | enable scripture memory verses
setting.set ~ {"args":{"id":"music","value":false}} ~ turn off the music features | disable the music features
setting.set ~ {"args":{"id":"photos","value":false}} ~ turn off the photo slideshow | hide my photos on the screen
setting.set ~ {"args":{"id":"diagnostics","value":false}} ~ turn off the developer log | disable diagnostics | turn off the debug log
setting.set ~ {"args":{"id":"keepScreenOpen","value":true}} ~ keep the screen open | keep the screen open please | turn on keeping the screen open
setting.set ~ {"args":{"id":"openOnStartup","value":true}} ~ open on startup | open the screen at startup | turn on open on startup
setting.set ~ {"args":{"id":"pronouns","value":"she"}} ~ my pronouns are she her | set my pronouns to she | use she her pronouns for me
setting.set ~ {"args":{"id":"pronouns","value":"he"}} ~ my pronouns are he him | set my pronouns to he
setting.get ~ {"args":{"id":"wakeWords"}} ~ what's my wake word set to? | what is the wake word | what's my wake word | what are my wake words
setting.set ~ {"args":{"id":"wakeWords","value":["computer"]}} ~ change the wake word to computer | set my wake word to computer
setting.set ~ {"args":{"id":"files","value":"off"}} ~ turn off file access | revoke file access | set file access to off | disable access to my files
setting.set ~ {"args":{"id":"files","value":"custom"}} ~ turn on file access | enable file access
setting.set ~ {"args":{"id":"files","value":"all"}} ~ give yourself access to all my files | set file access to all | give file access to everything
setting.set ~ {"args":{"id":"web","value":false}} ~ turn off web search | disable web search | turn off internet access
setting.set ~ {"args":{"id":"deleteFiles","value":true}} ~ allow deleting files | turn on deleting files | give permission to delete files
setting.set ~ {"args":{"id":"programs","value":"ask"}} ~ set opening programs to ask first | program access ask
setting.set ~ {"args":{"id":"browser","value":true}} ~ turn on browser control | allow browser control
setting.set ~ {"args":{"id":"claudeCode","value":true}} ~ turn on claude code | enable claude code
setting.set ~ {"args":{"id":"money","value":true}} ~ turn on the money review | enable money access
sky.weather ~ {"args":{"weather":"rain"}} ~ make it rain | can you make it rain | let it rain | rain please | show rain on the screen | i want rain on the screen | add some rain | make the background rainy | switch the sky to rain | a rainy day | raining | give me some rain
sky.weather ~ {"args":{"weather":"snow"}} ~ let it snow | make it snow | snow | snowing please | show snow on the screen | make the background snow | let it snow let it snow | i want snow
sky.weather ~ {"args":{"weather":"storm"}} ~ thunderstorm | a thunderstorm | make it stormy | make it thunder | give me a storm | stormy weather | show a thunderstorm on the screen | lightning storm
sky.weather ~ {"args":{"weather":"clear"}} ~ clear skies | sunny | make it sunny | clear sky | blue skies | sunshine please | make the sky clear | a sunny day
sky.weather ~ {"args":{"weather":"fog"}} ~ foggy | make it foggy | fog | misty | make the background misty
sky.weather ~ {"args":{"weather":"overcast"}} ~ make it cloudy | cloudy | make the sky gloomy | overcast
sky.weather ~ {"args":{"weather":"drizzle"}} ~ make it drizzle | drizzle | light rain
sky.weather ~ {"args":{"weather":"rain","minutes":10}} ~ make it rain for 10 minutes | let it rain for ten minutes | rain for 10 minutes | make it rain for the next 10 minutes
sky.weather ~ {"args":{"weather":"rain","minutes":60}} ~ let it rain for an hour | make it rain for 1 hour
sky.weather ~ {"args":{"weather":"snow","minutes":30}} ~ make it snow for half an hour | let it snow for 30 minutes
sky.weatherOff ~ {"args":{"weather":"rain"}} ~ stop the rain | no more rain | turn off the rain on the screen | get rid of the rain
sky.weatherOff ~ {"args":{"weather":"snow"}} ~ stop the snow | no more snow
sky.phase ~ {"args":{"phase":"night"}} ~ make it night | make it nighttime | night sky | show the night sky | make the sky night | switch the sky to night | change the background to night | make it midnight
sky.phase ~ {"args":{"phase":"sunset"}} ~ make it sunset | sunset | show me a sunset sky | change the background to a sunset | make the sky a sunset | sundown
sky.phase ~ {"args":{"phase":"sunrise"}} ~ make it sunrise | sunrise | make it dawn | dawn sky | change the sky to sunrise
sky.phase ~ {"args":{"phase":"midday"}} ~ make it noon | make it midday | make it daytime | noon sky | switch the sky to daytime
sky.phase ~ {"args":{"phase":"dusk"}} ~ make it dusk | make it twilight | make it evening | evening sky
sky.phase ~ {"args":{"phase":"golden"}} ~ make it golden hour | golden hour sky
sky.phase ~ {"args":{"phase":"afternoon"}} ~ make it afternoon | afternoon sky
sky.phase ~ {"args":{"phase":"night","minutes":60}} ~ make it night for an hour | make it nighttime for 1 hour
sky.real ~ {"args":{"what":"all"}} ~ show the real sky again | back to the real sky | real sky please | use the real world | back to the normal sky | reset the sky | reset the background
sky.real ~ {"args":{"what":"weather"}} ~ back to the real weather | go back to the real weather | show the real weather | follow the weather
sky.real ~ {"args":{"what":"time"}} ~ follow the sun | real time of day | back to the real time of day
sky.element ~ {"args":{"element":"stars","on":true}} ~ turn on the stars | show the stars | bring back the stars | show me the stars | turn on the moon
sky.element ~ {"args":{"element":"stars","on":false}} ~ turn off the stars | hide the stars | no more stars | hide the moon | get rid of the stars
sky.element ~ {"args":{"element":"clouds","on":false}} ~ turn off the clouds | no more clouds in the sky | hide the clouds
sky.element ~ {"args":{"element":"lightning","on":false}} ~ turn off the lightning | no more lightning
sky.element ~ {"args":{"element":"leaves","on":false}} ~ turn off the falling leaves | no more leaves | hide the petals
sky.element ~ {"args":{"element":"fireflies","on":true}} ~ turn on the fireflies | show the fireflies
sky.element ~ {"args":{"element":"raindrops","on":false}} ~ turn off the raindrops | no more drops on the glass
sky.amount ~ {"args":{"element":"clouds","dir":1}} ~ more clouds | add more clouds
sky.amount ~ {"args":{"element":"wind","dir":-1}} ~ less wind | less breeze
sky.amount ~ {"args":{"element":"leaves","dir":1}} ~ more leaves | more falling leaves
sky.scene ~ {"args":{"scene":"hills","asked":"mountains"}} ~ change the scenery to mountains | use the mountains background | show mountains in the background
sky.scene ~ {"args":{"scene":"hills","asked":"mountain"}} ~ mountain scenery | a mountain background
sky.scene ~ {"args":{"scene":"river","asked":"beach"}} ~ change the scenery to the beach | beach scenery | a beach background
sky.scene ~ {"args":{"scene":"forest"}} ~ use the forest scene | change the scenery to forest | forest background | show the forest scenery
sky.scene ~ {"args":{"scene":"fields"}} ~ fields scenery | change the scene to fields | use the fields background
sky.scene ~ {"args":{"scene":"river"}} ~ river scenery | use the river scene
sky.scene ~ {"args":{"scene":"hills"}} ~ hills scenery | use the hills scene
sky.scene ~ {"args":{"scene":"none"}} ~ no scenery | turn off the scenery | hide the scenery
sky.scene ~ {"args":{"scene":"rotate"}} ~ rotate the scenery | change the scenery every day | mix up the scenery
sky.motion ~ {"args":{"motion":"still"}} ~ pause the animation | pause the sky | freeze the background | stop the animation | still background | stop the sky from moving | pause the animations
sky.motion ~ {"args":{"motion":"normal"}} ~ resume the animation | unpause the sky | animate the sky again | start the animation again | let the background move
sky.motion ~ {"args":{"motion":"reduced"}} ~ slow down the sky | calm the background | calmer sky | slower background
sky.season ~ {"args":{"season":"winter"}} ~ make it winter | winter scenery | make the background look like winter | make it christmas
sky.season ~ {"args":{"season":"fall"}} ~ make it fall | make it autumn | autumn scenery | fall look
sky.season ~ {"args":{"season":"spring"}} ~ make it spring | spring scenery
sky.season ~ {"args":{"season":"summer"}} ~ make it summer | summer scenery
sky.preset ~ {"args":{"preset":"cozy"}} ~ cozy vibe | cozy mode | switch to cozy mode | make the background cozy | a cozy look
sky.preset ~ {"args":{"preset":"calm"}} ~ calm vibe | calm background | a calm sky
sky.preset ~ {"args":{"preset":"vivid"}} ~ vivid mode | a vivid background | colorful sky vibe
sky.preset ~ {"args":{"preset":"nightowl"}} ~ night owl mode | night owl vibe
sky.preset ~ {"args":{"preset":"focus"}} ~ focus vibe | focus mode for the background
sky.on ~ {"args":{"on":false}} ~ a plain background | plain background | turn off the living sky | just a plain background | hide the animated background
sky.on ~ {"args":{"on":true}} ~ turn on the living sky | bring back the animated background
sky.colors ~ {"args":{"how":"warmer"}} ~ make the background warmer | warmer sky | a warmer background
sky.colors ~ {"args":{"how":"darker"}} ~ make the background darker | darker sky
sky.colors ~ {"args":{"how":"brighter"}} ~ make the sky brighter | brighter background
sky.colors ~ {"args":{"how":"cooler"}} ~ make the background cooler | cooler sky colors
sky.status ~ {} ~ what's the sky set to | what is the background set to | what's the scenery set to
ui.window ~ {"args":{"canon":"compact mode"}} ~ compact mode | go to compact mode | switch to compact mode | mini mode | make yourself small | go into compact mode | switch to mini
ui.window ~ {"args":{"canon":"full screen"}} ~ full screen | go full screen | make it full screen | full screen mode | switch to full screen | fill the whole screen
ui.window ~ {"args":{"canon":"exit full screen"}} ~ exit full screen | leave full screen | get out of full screen
ui.window ~ {"args":{"canon":"move dayspring to the other screen"}} ~ move to the other screen | move yourself to the other screen | go to the other screen | move dayspring to the tv | switch to the second screen | put yourself on the other monitor
ui.window ~ {"args":{"canon":"move dayspring to the main screen"}} ~ move to the main screen | go back to the main screen | move yourself to the laptop screen
ui.window ~ {"args":{"canon":"minimize"}} ~ minimize | minimize yourself | minimize the window
ui.window ~ {"args":{"canon":"show yourself"}} ~ show yourself | come back | bring back the window
ui.window ~ {"args":{"canon":"expand"}} ~ expand | go back to the big window | full size window
sched.create ~ {"args":{"title":"dentist appointment","date":"2026-10-06","time":"15:00","repeat":null}} ~ schedule a dentist appointment next Tuesday at 3 | add a dentist appointment next tuesday at 3pm | book a dentist appointment next tuesday at 3 pm | put a dentist appointment on my calendar next tuesday at 3 | I have a dentist appointment next Tuesday at 3
sched.create ~ {"args":{"title":"gym","time":"06:00","minutes":60,"repeat":{"freq":"weekly","days":["mon","wed","fri"]}}} ~ add gym every Monday Wednesday Friday at 6am for an hour | add gym every monday, wednesday and friday at 6 am for an hour | schedule gym mondays wednesdays and fridays at 6am for 1 hour | put gym on every mon wed fri at 6am for an hour
sched.create ~ {"args":{"title":"bible study","time":"21:00","repeat":{"freq":"weekly","days":["mon","tue","wed","thu","fri"]}}} ~ Bible study every weeknight at 9 | add bible study every weeknight at 9 | schedule Bible study weeknights at 9 | bible study on weeknights at 9pm
sched.create ~ {"args":{"title":"team sync","time":"10:00","repeat":{"freq":"monthly","nth":{"n":1,"day":"mon"}}}} ~ add team sync the first Monday of every month at 10 | schedule team sync on the first monday of each month at 10 | team sync the first monday of the month at 10am
sched.create ~ {"args":{"title":"review","time":"15:00","repeat":{"freq":"monthly","nth":{"n":-1,"day":"fri"}}}} ~ schedule a review on the last friday of every month at 3pm | add review the last friday of each month at 3 pm
sched.create ~ {"args":{"title":"piano","time":"16:00","repeat":{"freq":"monthly","monthDay":15}}} ~ add piano on the 15th of each month at 4pm | schedule piano on the fifteenth of every month at 4 pm | add piano every month on the 15th at 4pm
sched.create ~ {"args":{"title":"walk","time":"07:00","repeat":{"freq":"daily","until":"2026-11-30"}}} ~ add walk every day until December at 7am | add a walk every day until december at 7 am | schedule a walk daily until December at 7am
sched.create ~ {"args":{"title":"standup","time":"13:00","repeat":{"freq":"weekly","until":"2026-10-18"}}} ~ add standup weekdays at 1pm for the next 3 weeks | schedule standup every weekday at 1 pm for the next three weeks
sched.create ~ {"args":{"title":"yoga","time":"18:00","repeat":{"freq":"weekly","days":["mon","tue","wed","thu","fri"]}}} ~ add yoga weekdays only at 6pm | schedule yoga on weekdays at 6 pm | add yoga monday through friday at 6pm | add yoga every day except weekends at 6pm
sched.create ~ {"args":{"title":"trash night","repeat":{"exceptHolidays":true}}} ~ add trash night every thursday at 8pm except holidays | schedule trash night every thursday at 8 pm except holidays
sched.create ~ {"args":{"title":"date night","time":"19:00","repeat":{"freq":"weekly","interval":2,"days":["fri"]}}} ~ add date night every other friday at 7pm | schedule date night every second friday at 7 pm | add date night biweekly on friday at 7pm
sched.create ~ {"args":{"title":"standup","repeat":{"freq":"weekly","interval":2}}} ~ add standup every other week on monday at 10 | schedule standup every two weeks on monday at 10
sched.create ~ {"args":{"title":"piano lesson","time":"16:00","repeat":{"freq":"weekly","days":["mon","tue","wed","thu","fri","sat"]}}} ~ add piano lesson every day except sunday at 4pm | schedule piano lesson daily except sundays at 4 pm
sched.create ~ {"args":{"title":"call with grandma","time":"18:00","repeat":{"freq":"weekly","days":["sun"]}}} ~ add call with grandma every sunday evening | schedule call with grandma every sunday evening
sched.create ~ {"args":{"title":"church","time":"10:30","repeat":{"freq":"weekly","days":["sun"]}}} ~ add church every sunday at 10:30 am | schedule church sundays at 10:30am | church every sunday at 10:30 am
sched.create ~ {"args":{"title":"soccer practice","time":"17:30","repeat":{"freq":"weekly","days":["tue","thu"]}}} ~ schedule soccer practice every tuesday and thursday at 5:30pm | add soccer practice tuesdays and thursdays at 5:30 pm
sched.create ~ {"args":{"title":"team meeting","repeat":{"exceptHolidays":true,"days":["mon","tue","wed","thu","fri"]}}} ~ add team meeting every weekday at 9am except holidays
sched.create ~ {"args":{"title":"piano","time":"16:00","repeat":{"start":"2026-10-05"}}} ~ schedule piano every monday at 4 starting next week | add piano every monday at 4pm starting next week
sched.create ~ {"args":{"title":"stretching","time":"21:00","repeat":{"freq":"daily"}}} ~ add stretching every night at 9 | add stretching nightly at 9
sched.create ~ {"args":{"title":"haircut","date":"2026-10-03","time":"10:00","repeat":null}} ~ add a haircut this weekend at 10 | schedule a haircut this weekend at 10 | put a haircut on saturday at 10
sched.create ~ {"args":{"title":"call","date":"2026-10-01","time":"16:00"}} ~ schedule a call in 3 days at 4 | add a call in three days at 4pm
sched.create ~ {"args":{"title":"dentist","date":"2026-10-05","time":"14:00"}} ~ add dentist next month on the 5th at 2 | add dentist on the 5th of next month at 2pm
sched.create ~ {"args":{"title":"dinner with the smiths","date":"2026-09-28"}} ~ put dinner with the smiths tonight | add dinner with the smiths tonight
sched.create ~ {"args":{"title":"coffee","time":"18:30"}} ~ add coffee at half past 6 | schedule coffee at half past six
sched.create ~ {"args":{"title":"meeting","time":"08:45"}} ~ add meeting at quarter to 9 | schedule a meeting at quarter to nine
sched.create ~ {"args":{"title":"lunch with sam","date":"2026-09-29","time":"12:00"}} ~ schedule lunch with sam tomorrow | add lunch with sam tomorrow
sched.create ~ {"args":{"title":"doctor appointment","date":"2026-10-02","time":"10:30"}} ~ I have a doctor appointment on friday at 10:30 | schedule a doctor appointment friday at 10:30
sched.create ~ {"args":{"title":"massage","date":"2026-10-03","time":"14:00","minutes":90}} ~ book a massage for saturday at 2 for 90 minutes | schedule a massage saturday at 2pm for an hour and a half
sched.create ~ {"args":{"title":"study group","date":"2026-09-29","time":"15:00","minutes":120}} ~ add study group from 3 to 5 tomorrow | schedule study group tomorrow from 3 to 5
sched.create ~ {"args":{"title":"coffee with alex","date":"2026-10-03","time":"09:00"}} ~ pencil in coffee with alex saturday at 9am | put coffee with alex on saturday at 9 am
sched.create ~ {"args":{"title":"moms birthday dinner","date":"2026-10-12","time":"18:00"}} ~ add mom's birthday dinner on october 12th at 6pm | schedule mom's birthday dinner october 12 at 6 pm
sched.create ~ {"args":{"title":"dentist","date":"2026-10-02","time":"15:00"}} ~ add dentist friday at 3 | schedule the dentist on friday at 3 | book dentist friday at 3pm
sched.create ~ {"args":{"needTitle":true}} ~ schedule something tomorrow at 3
sched.create ~ {"args":{"title":"haircut","time":null}} ~ schedule a haircut | book a haircut | add a haircut to my calendar
sched.move ~ {"args":{"ref":"3pm","time":"16:00"}} ~ move my 3pm to 4 | move my 3pm to 4pm | reschedule my 3pm to 4 | push my 3pm to 4
sched.move ~ {"args":{"ref":"it","time":"17:00"}} ~ move it to 5 | move it to 5pm | make it 5 | make it 5 pm instead | move that to 5
sched.move ~ {"args":{"ref":"it","time":"18:00"}} ~ make it 6pm instead | actually make it 6pm | move it to 6 pm
sched.move ~ {"args":{"ref":"dentist","time":"16:00"}} ~ move the dentist to 4pm | move the dentist to 4 | reschedule the dentist to 4pm | change the dentist to 4 pm
sched.move ~ {"args":{"ref":"meeting","date":"2026-10-01"}} ~ push the meeting to thursday | move the meeting to thursday | reschedule the meeting to thursday
sched.move ~ {"args":{"ref":"gym","date":"2026-09-29","time":"07:00"}} ~ move gym to tomorrow at 7 | reschedule gym to tomorrow at 7am
sched.move ~ {"args":{"ref":"gym","series":true,"time":"07:00"}} ~ move all gym to 7 | move every gym to 7am
sched.cancel ~ {"args":{"ref":"gym","date":"2026-10-02"}} ~ cancel Friday's gym | cancel gym on friday | skip gym on friday | remove gym this friday | delete gym on friday
sched.cancel ~ {"args":{"ref":"gym","date":"2026-09-29"}} ~ skip gym tomorrow | cancel gym tomorrow | cancel tomorrow's gym
sched.cancel ~ {"args":{"ref":null,"time":"15:00"}} ~ cancel my 3pm | cancel my 3 pm
sched.cancel ~ {"args":{"ref":"dentist"}} ~ cancel the dentist | delete the dentist | remove the dentist from my calendar
sched.cancel ~ {"args":{"ref":"dentist appointment"}} ~ cancel my dentist appointment | delete the dentist appointment
sched.cancel ~ {"args":{"ref":"gym session","date":"2026-10-02"}} ~ cancel friday's gym session
sched.norecur ~ {"args":{"ref":"it"}} ~ stop repeating | stop repeating it | don't repeat it | do not repeat that | make it one time | make it a one time thing
sched.norecur ~ {"args":{"ref":"gym"}} ~ cancel all gym | stop gym for good | gym should not repeat anymore | end the gym series | cancel all future gym | delete every gym
sched.recur ~ {"args":{"ref":"it","repeat":null}} ~ make it recurring | make that recurring | make it repeat | make it a recurring event | have it repeat
sched.recur ~ {"args":{"ref":"it","repeat":{"freq":"weekly","interval":1}}} ~ make it weekly | make that weekly | make it repeat every week | have it repeat weekly
sched.recur ~ {"args":{"ref":"it","repeat":{"freq":"weekly","interval":2}}} ~ change it to every two weeks | make it every other week | change that to every other week | make that every other week instead | change it to biweekly
sched.recur ~ {"args":{"ref":"gym","repeat":{"freq":"weekly","days":["mon"]}}} ~ make gym repeat every monday | make gym happen every monday | have gym repeat every monday
sched.recur ~ {"args":{"ref":"bible study","repeat":{"days":["mon","wed"]}}} ~ change bible study to mondays and wednesdays | move bible study to every monday and wednesday
sched.recur ~ {"args":{"ref":"it","repeat":{"freq":"daily"}}} ~ make it daily | make it repeat every day | change it to every day
sched.recur ~ {"args":{"ref":"it","repeat":{"freq":"monthly"}}} ~ make it monthly | change it to every month
reminder.create ~ {"args":{"text":"take out the trash","time":"20:00","repeat":{"freq":"weekly","days":["thu"]}}} ~ remind me to take out the trash every Thursday night | remind me every thursday night to take out the trash | set a reminder to take out the trash every thursday night | take out the trash reminder every thursday night
reminder.create ~ {"args":{"text":"pay rent","time":"09:00","repeat":{"freq":"monthly","monthDay":1}}} ~ remind me to pay rent on the 1st of every month at 9am | remind me to pay rent on the first of every month at 9am | remind me to pay rent every month on the 1st at 9 am
reminder.create ~ {"args":{"text":"pay rent","repeat":{"freq":"monthly","monthDay":15}}} ~ remind me to pay rent on the 15th of each month | pay rent reminder on the 15th of each month | remind me on the fifteenth of every month to pay rent
reminder.create ~ {"args":{"text":"drink water","time":"23:00","date":null}} ~ remind me to drink water at 11pm | remind me to drink water at 11 pm | set a reminder to drink water at 11pm | don't let me forget to drink water at 11pm
reminder.create ~ {"args":{"text":"drink water","time":"23:00","date":"2026-09-28"}} ~ remind me to drink water at 11 tonight | remind me to drink water tonight at 11
reminder.create ~ {"args":{"text":"drink water","time":"07:30","loose":true}} ~ remind me to drink water at 7:30 | remind me at 7:30 to drink water
reminder.create ~ {"args":{"text":"drink water","time":"06:00","date":"2026-09-29"}} ~ remind me to drink water tomorrow at 6am | remind me tomorrow at 6 am to drink water
reminder.create ~ {"args":{"text":"drink water","time":"23:00","repeat":{"freq":"daily"}}} ~ remind me to drink water every day at 11pm | remind me every day at 11pm to drink water | remind me to drink water daily at 11 pm
reminder.create ~ {"args":{"text":"call mom","time":"18:00","date":"2026-09-29"}} ~ remind me to call mom tomorrow at 6pm | remind me tomorrow at 6 pm to call mom
reminder.create ~ {"args":{"text":"take my pills","time":"08:00","repeat":{"freq":"daily"}}} ~ remind me to take my pills every morning at 8 | remind me every morning at 8 to take my pills
reminder.create ~ {"args":{"text":"water the plants","repeat":{"freq":"weekly","days":["sun"]}}} ~ remind me to water the plants every sunday | remind me every sunday to water the plants
reminder.create ~ {"args":{"text":"check the mail","repeat":{"freq":"weekly","days":["mon","tue","wed","thu","fri"]}}} ~ remind me to check the mail every weekday at 4pm | remind me on weekdays at 4 pm to check the mail
reminder.create ~ {"args":{"text":"say thank you","time":"17:00"}} ~ remind me to say thank you at 5pm | remind me to say thank you at 5 pm
reminder.create ~ {"args":{"text":"pay the bills","date":"2026-10-05"}} ~ remind me to pay the bills next month on the 5th at 9am
reminder.create ~ {"args":{"needText":true}} ~ remind me at 5pm | remind me tomorrow at 9am
reminder.cancel ~ {"args":{"text":"call mom"}} ~ don't remind me to call mom | do not remind me to call mom | i don't need the reminder to call mom
reminder.cancel ~ {"args":{"text":null}} ~ don't remind me | never mind the reminder
every.start ~ {"args":{"ms":1800000,"text":"stand up"}} ~ every 30 minutes remind me to stand up | remind me to stand up every 30 minutes | remind me every 30 minutes to stand up | remind me to stand up every half hour | every half hour remind me to stand up
every.start ~ {"args":{"ms":3600000,"text":"stretch"}} ~ remind me to stretch every hour | every hour remind me to stretch | remind me every hour to stretch | remind me to stretch hourly
every.start ~ {"args":{"ms":3600000,"text":"drink water"}} ~ remind me to drink water every hour | remind me to drink water hourly | every hour remind me to drink water
every.start ~ {"args":{"ms":1800000,"text":"drink water"}} ~ remind me to drink water every 30 minutes | every 30 minutes remind me to drink water
every.start ~ {"args":{"ms":7200000,"text":"check the oven"}} ~ remind me to check the oven every 2 hours | every two hours remind me to check the oven
every.start ~ {"args":{"ms":900000,"text":"blink"}} ~ remind me to blink every 15 minutes | every 15 minutes remind me to blink
every.stop ~ {"args":{"text":"stand up"}} ~ stop reminding me to stand up | stop the stand up reminders | no more stand up reminders | cancel the stand up reminders | turn off the stand up reminder
every.stop ~ {"args":{"text":"stretch"}} ~ stop reminding me to stretch | stop the stretch reminders
timer.until ~ {"args":{"hm":"07:45","loose":true}} ~ set a timer for 7:45 | timer for 7:45 | start a timer until 7:45 | set a timer to go off at 7:45
timer.until ~ {"args":{"hm":"17:00","loose":false}} ~ set a timer until 5 pm | timer until 5pm | set a timer till 5 pm | set a timer that goes off at 5pm
timer.until ~ {"args":{"hm":"15:30"}} ~ timer till 3:30 | set a timer until 3:30
timer.until ~ {"args":{"hm":"12:00"}} ~ set a timer until noon | timer until noon
alarm.create ~ {"args":{"hm":"07:00","days":[0,1,2,3,4,5,6]}} ~ a timer that goes off every day at 7 | set a timer that goes off every day at 7 | alarm at 7 every day | set an alarm for 7 every day | wake me up at 7 every day | set a daily alarm at 7 | an alarm every morning at 7
alarm.create ~ {"args":{"hm":"06:30","days":[1,2,3,4,5]}} ~ set an alarm for weekdays at 6:30 | set an alarm for 6:30 on weekdays | wake me up at 6:30 on weekdays | weekday alarm at 6:30 | set an alarm at 6:30 every weekday | alarm for 6:30 monday through friday
alarm.create ~ {"args":{"hm":"08:00","date":"2026-10-03"}} ~ set an alarm for Saturday at 8 | set an alarm for 8 on saturday | wake me up saturday at 8 | alarm saturday at 8am
alarm.create ~ {"args":{"hm":"08:00","days":[0,6]}} ~ set an alarm for 8 on weekends | wake me up at 8 on weekends | weekend alarm at 8am | alarm at 8 every saturday and sunday
alarm.create ~ {"args":{"hm":"06:00","days":[1,2,3,4,5]}} ~ wake me up at 6 every weekday | set an alarm for 6 every weekday
alarm.create ~ {"args":{"hm":"07:00","loose":false}} ~ set an alarm for 7am | set an alarm for 7 am | wake me up at 7am | set my alarm for 7am | alarm at 7 in the morning | set an alarm for 7
alarm.create ~ {"args":{"hm":"06:30","date":"2026-09-29"}} ~ wake me up at 6:30 tomorrow | set an alarm for 6:30 tomorrow | set an alarm for tomorrow at 6:30
alarm.create ~ {"args":{"hm":"06:00","sound":"bells","gentle":true}} ~ set a gentle alarm for 6 with the bells | set an alarm for 6 with bells and a gentle wake | a gentle wake alarm at 6 with the bells
alarm.create ~ {"args":{"hm":"05:30","label":"gym","volume":100,"snooze":5}} ~ set a loud alarm for 5:30 called gym with a 5 minute snooze | set a loud alarm at 5:30 called gym with a 5 minute snooze
alarm.create ~ {"args":{"hm":"07:00","flash":true}} ~ set an alarm for 7 that flashes the screen | set an alarm for 7 and flash the screen | set a flashing alarm for 7 | set an alarm for 7 with vibrate
alarm.create ~ {"args":{"hm":"06:45"}} ~ set an alarm for 6:45 just once | set a one time alarm for 6:45
alarm.create ~ {"args":{"hm":"05:00","rule":{"freq":"daily","interval":2}}} ~ set an alarm every other day at 5am | set an alarm for 5am every other day
alarm.create ~ {"args":{"hm":"08:00","days":[0,6],"sound":"birds"}} ~ set an alarm for 8 on weekends with birds | set a weekend alarm at 8 with the birds sound
alarm.create ~ {"args":{"hm":"06:00","volume":40}} ~ set a quiet alarm for 6 | set an alarm for 6 at 40 percent volume
alarm.create ~ {"args":{"hm":"07:30","label":"work"}} ~ set an alarm for 7:30 am called work | set an alarm at 7:30am named work
alarm.create ~ {"args":{"needTime":true}} ~ set an alarm | create an alarm | i need an alarm | set a new alarm | set an alarm called goodbye
alarm.list ~ {} ~ what alarms do I have | list my alarms | show my alarms | what alarms are set | do i have any alarms | how many alarms do i have | when is my next alarm | what time is my alarm
alarm.onoff ~ {"args":{"on":false,"filter":{"days":[0,6]}}} ~ turn off my weekend alarms | disable my weekend alarms | turn my weekend alarms off | switch off the weekend alarms
alarm.onoff ~ {"args":{"on":true,"filter":{"days":[0,6]}}} ~ turn my weekend alarms back on | turn on my weekend alarms | enable the weekend alarms
alarm.onoff ~ {"args":{"on":false,"filter":{"days":[1,2,3,4,5]}}} ~ turn off my weekday alarms | disable the weekday alarms
alarm.onoff ~ {"args":{"on":false,"filter":{"hm":"06:30"}}} ~ turn off the 6:30 alarm | disable my 6:30 alarm
alarm.onoff ~ {"args":{"on":false}} ~ turn off my alarm | turn off my alarms | disable my alarm | switch off my alarm
alarm.skip ~ {"args":{"day":"tomorrow"}} ~ skip tomorrow's alarm | skip my alarm tomorrow | skip the alarm for tomorrow | no alarm tomorrow | don't wake me up tomorrow | skip tomorrow's alarms
alarm.skip ~ {"args":{"day":"saturday"}} ~ skip saturday's alarm | skip my alarm on saturday | no alarm on saturday
alarm.skip ~ {"args":{"day":"next"}} ~ skip the next alarm | skip my next alarm
alarm.delete ~ {"args":{"filter":{"hm":"06:30"}}} ~ delete the 6:30 alarm | remove the 6:30 alarm | cancel the 6:30 alarm | get rid of my 6:30 alarm
alarm.delete ~ {"args":{"filter":{"label":"gym"}}} ~ delete the gym alarm | cancel my gym alarm | remove the gym alarm
alarm.delete ~ {"args":{"filter":{"all":true}}} ~ delete all my alarms | cancel all alarms | remove all the alarms
alarm.delete ~ {"args":{"filter":{}}} ~ cancel my alarm | delete my alarm | remove my alarm
alarm.change ~ {"args":{"filter":{"hm":"06:30"},"hm":"18:45","loose":true}} ~ change my 6:30 alarm to 6:45 | move my 6:30 alarm to 6:45
alarm.change ~ {"args":{"volumeDelta":20}} ~ make the alarm loud | make my gym alarm louder
setting.adjust ~ {"args":{"id":"alarmVolume","delta":15}} ~ make my alarm louder | make the alarms louder
alarm.change ~ {"args":{"gentle":true}} ~ make my alarm gentle | make the alarm gentler
alarm.change ~ {"args":{"filter":{"hm":"06:30"},"label":"gym"}} ~ rename the 6:30 alarm to gym
alarm.change ~ {"args":{"snooze":5}} ~ set the snooze on my alarm to 5 minutes
alarm.change ~ {"args":{"hm":"06:00"}} ~ change my alarm to 6am | move my alarm to 6 in the morning
alarm.create ~ {"args":{"hm":"06:00"}} ~ set my alarm for 6 in the morning
profile.name ~ {"args":{"name":"Morgan","how":"name"}} ~ my name is Morgan | my name's Morgan | actually my name is Morgan | the name is Morgan | i am called Morgan
profile.name ~ {"args":{"name":"Robin","how":"nickname"}} ~ call me Robin | you can call me Robin | please call me Robin | just call me Robin | everyone calls me Robin
profile.name ~ {"args":{"name":"Z","how":"nickname"}} ~ I go by Z | people call me Z
profile.nickname ~ {"args":{"add":"Ziggy"}} ~ add a nickname Ziggy | add the nickname Ziggy | save a nickname Ziggy | add Ziggy to my nicknames
profile.nickname ~ {"args":{"remove":"Ziggy"}} ~ remove the nickname Ziggy | delete my nickname Ziggy | don't call me Ziggy anymore | stop calling me Ziggy | remove Ziggy from my nicknames
profile.whoami ~ {} ~ what's my name? | what is my name | what do you call me? | do you know my name | who am i | what are my nicknames | do you know who i am
profile.location ~ {"args":{"place":"springfield illinois"}} ~ I live in Springfield, Illinois | i live in springfield illinois | we live in Springfield Illinois | my town is Springfield, Illinois | set my location to Springfield, Illinois | my home is springfield illinois
profile.location ~ {"args":{"place":"peoria"}} ~ set my location to Peoria | change my location to Peoria | update my location to peoria | my city is peoria
profile.location ~ {"args":{"place":"62701","zip":true}} ~ my zip code is 62701 | my zip is 62701 | set my zip code to 62701 | my postal code is 62701
profile.location ~ {"args":{"place":"decatur"}} ~ I moved to Decatur | i just moved to decatur | we moved to decatur | i relocated to decatur | i have moved to decatur
profile.where ~ {} ~ where do you think I am? | where am i | where do i live | what is my location | what's my zip code | what town do you have me in
profile.here ~ {} ~ use my current location | find my location | detect my location | get my current location
profile.fact ~ {"args":{"kind":"job","text":"I'm a carpenter"}} ~ I'm a carpenter | I am a carpenter | i work as a carpenter | my job is carpenter | i'm working as a carpenter
profile.fact ~ {"args":{"kind":"job","text":"I'm a teacher"}} ~ I'm a teacher | i work as a teacher | my profession is teacher
profile.fact ~ {"args":{"kind":"work","value":"acme tools"}} ~ I work at Acme Tools | i work for acme tools | i'm employed at acme tools
profile.birthday ~ {"args":{"day":"july 9th"}} ~ my birthday is July 9th | my birthday's july 9th | i was born on july 9th | my bday is july 9th
profile.interest ~ {"args":{"add":["kayaking","d d"]}} ~ I like kayaking and D&D | i love kayaking and d&d | i'm into kayaking and D&D | my hobbies are kayaking and d&d | i enjoy kayaking and D&D
profile.interest ~ {"args":{"add":["fishing"]}} ~ add fishing to my interests | put fishing on my interests | add fishing to my hobbies | i like fishing | i'm interested in fishing
profile.interest ~ {"args":{"remove":["d d"]}} ~ remove D&D from my interests | take d&d off my interests | delete d&d from my hobbies
profile.dislike ~ {"args":{"text":"country music"}} ~ I don't like country music | i do not like country music | i hate country music | i can't stand country music | i'm not a fan of country music
profile.about ~ {} ~ what do you know about me? | what do you know about me | what have i told you about myself | what do you remember about me | tell me what you know about me
profile.about ~ {"args":{"interestsOnly":true}} ~ what are my interests | what am i interested in
profile.forget ~ {"args":{"text":"i like country music"}} ~ forget that I like country music | forget i like country music
profile.forget ~ {"args":{"text":"i am a carpenter"}} ~ forget that I'm a carpenter | forget that i am a carpenter
profile.tour ~ {} ~ let me tell you about myself | i want to tell you about myself | get to know me | tell you about me | set up my profile | interview me
compound ~ {"args":{"parts":["turn off the lights","set a timer for 10 minutes"]}} ~ turn off the lights and set a timer for 10 minutes | turn off the lights, then set a timer for 10 minutes
compound ~ {"args":{"parts":["turn off the weather","make it rain"]}} ~ turn off the weather and make it rain
compound ~ {"args":{"parts":["set the volume to 40","use 24 hour time"]}} ~ set the volume to 40 and use 24 hour time | set the volume to 40 and also use 24-hour time
compound ~ {"args":{"parts":["make it snow","hide the clock"]}} ~ make it snow and hide the clock | make it snow then hide the clock
compound ~ {"args":{"parts":["set an alarm for 7am","remind me to take my pills at 8am"]}} ~ set an alarm for 7am and remind me to take my pills at 8am
compound ~ {"args":{"parts":["pause the music","make it night"]}} ~ pause the music and make it night
correct ~ {"args":{"not":"tomorrow","to":"friday"}} ~ not tomorrow, friday | no not tomorrow friday | not tomorrow, make it friday | no, not tomorrow, on friday
correct ~ {"args":{"not":"at 5","to":"6"}} ~ no, not at 5, at 6 | not at 5 at 6
correct ~ {"args":{"not":null,"to":"6pm"}} ~ i said 6pm | no i meant 6pm | i meant 6pm
noop ~ {} ~ don't set a timer | don't add that | don't schedule it
none ~ {} ~ what's the weather | what's the weather like | is it going to rain | will it snow tomorrow | do i need an umbrella | set a timer for 10 minutes | set a pasta timer for 8 minutes | pause the pasta timer | add 5 minutes to the laundry timer | how long is left on the laundry | what timers do i have | what time is it | what's the date | add milk to my shopping list | add milk and eggs to my shopping list | remind me to call mom and dad | remind me in 20 minutes to flip the chicken | remind me to drink water in 2 hours | remind me tomorrow to pay the bills | what's on tomorrow | what's next | tell me a joke | play some music | play see you again by charlie puth | read john 3:16 | turn it up | louder | what's 12 times 14 | open spotify | pink theme | use the blob avatar | change your voice to Rachel | your name is Nova | call me later | call me at 5 | I'm going to Chicago tomorrow | I'm in Chicago this week | I'm tired | I am in the kitchen | I love you | I like it | I don't like that | I'm from Ohio | remind me to say | who are you | how are you | good morning | knock knock | stop listening | text mom thanks | what's your name | move the window to the left | push everything back 30 minutes | show me my week | the second one | yes | no | next step
`;
