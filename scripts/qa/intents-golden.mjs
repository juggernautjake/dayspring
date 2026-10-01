// What people actually say, and what Dayspring should understand without AI. Written by hand (not generated from the
// catalogue's own phrasings), one intent per line: "id: phrase | phrase | …". A line starting with "[cooking]",
// "[results]", "[ringing]" or "[timers]" is said while that's going on. scripts/test-intents.mjs adds the everyday
// variations (a wake word in front, "please", a small typo) and checks top-1 and top-7 accuracy per family.
import "./guard-data.mjs";   // first: tests never write to the real data folder
export const GOLDEN_TEXT = `
time.now: what time is it | what's the time | do you know what time it is | tell me the time | what time is it right now | time check | got the time | how late is it | what time do you have | is it noon yet
date.today: what's the date | what day is it | what's today's date | what day of the week is it | what's the date today | what month is it | what year is it | is today tuesday | what is today
date.until: how many days until christmas | how long until my birthday on june 3rd | days until thanksgiving | how many days till friday | how long until new year's | countdown to july 4th | how many days left until halloween | how many more days until easter | how many weeks until christmas
time.city: what time is it in tokyo | what's the time in london | time in new york | what time is it in california | what's the time over in paris right now | current time in sydney | what time is it in chicago
date.holiday: when is easter | when is thanksgiving this year | what's the next holiday | is today a holiday | when is mother's day | what day is christmas on | when is labor day
sched.next: what's next | what's my next thing | what do i have next | what's coming up | what's the next thing on my schedule | when's my next appointment | what am i doing next | anything coming up soon
sched.now: what should i be doing right now | what am i supposed to be doing | what's on right now | what's happening now | what's the current block | what time block am i in
sched.day: what's on my schedule today | what do i have today | what's my day look like | what's on tomorrow | what do i have on friday | what's my schedule for saturday | read me today's schedule | anything on the calendar tomorrow | what's planned for monday | what am i doing tomorrow | how busy am i today
sched.week: what's my week look like | show me this week | what do i have this week | what's on next week | how busy is my week | read me the week
sched.month: show me the month | what's this month look like | show my calendar for the month | what do i have in october
sched.year: show me the year | show the whole year | yearly view
sched.open: open my calendar | show my calendar | pull up the schedule | show me the schedule | open the planner
sched.add: add dentist friday at 3 | schedule a haircut tomorrow at 10am | put lunch with sam on thursday at noon | add a meeting at 2pm | book a doctor appointment on monday at 9 | add gym tomorrow at 6am | put church on sunday at 10 | schedule a call with mom at 7pm | add study time tonight at 8 | create an event called team sync on wednesday at 11 | pencil in coffee with alex saturday at 9am | add grocery shopping at 5pm
sched.move: move the dentist to 4 | move my meeting to 3pm | reschedule the haircut to friday | move gym to tomorrow at 7 | can we move lunch to 1pm | change the doctor appointment to tuesday | move study time to 9pm | push the meeting to thursday
sched.push: push everything back 30 minutes | push my meeting back 15 minutes | delay the dentist by an hour | move everything later by 20 minutes | bump lunch back half an hour | push the rest of my day back an hour | move gym earlier by 30 minutes
sched.rename: rename the meeting to team sync | change the name of gym to workout | call the dentist appointment checkup | rename lunch to lunch with sam
sched.delete: cancel the dentist | delete my meeting | remove gym from my schedule | take lunch off my calendar | delete the haircut on friday | cancel my appointment tomorrow | get rid of study time tonight
sched.resize: make the meeting an hour long | make gym 30 minutes longer | shorten lunch by 15 minutes | make study time two hours | extend the meeting by half an hour | cut the call to 20 minutes
sched.free: am i free at 3 | when am i free today | do i have any free time tomorrow | am i busy at noon | when's my next free slot | do i have time for a nap this afternoon | is friday afternoon open
sched.conflicts: do i have any conflicts | are there any overlaps this week | do any of my events clash | check for double bookings
sched.clear: clear my afternoon | clear the rest of my day | clear my schedule tomorrow morning | cancel everything this evening | wipe my calendar for tonight
sched.repeat: make gym repeat every weekday | make lunch happen every day | repeat the meeting every monday | make study time every other day | make church weekly on sundays
sched.done: i finished my workout | mark gym as done | i'm done with study time | check off the meeting | i did my reading
sched.undo: undo that | undo the last change | put it back | take that back | undo
sched.rundown: give me my rundown | what's my day like | brief me on today | morning briefing | give me the rundown for today
timer.start: set a timer for 10 minutes | 10 minute timer | start a timer for 5 minutes | timer for 30 seconds | set a pasta timer for 8 minutes | set a timer for an hour and a half | countdown 3 minutes | time 15 minutes | set a 20 minute timer for the laundry | start a two minute timer | give me a timer for 45 minutes | put on a timer for 12 minutes | set the oven timer for 25 minutes | remind me in 20 minutes to flip the chicken | wake me up in 30 minutes | set an egg timer for 7 minutes | can you time 4 minutes for my tea | start a countdown for 90 seconds
[timers] timer.list: what timers do i have | what timers are running | list my timers | how many timers are going | show me my timers | any timers running
[timers] timer.left: how long left on the pasta | how much time is left on my timer | how long until the timer goes off | how much longer on the oven timer | time left on the laundry | how long is left | is the rice timer almost done | check the pasta timer
[timers] timer.cancel: cancel the timer | cancel the rice timer | stop the pasta timer | delete the laundry timer | cancel all timers | turn off the oven timer | get rid of the second timer | kill the timer | remove timer 2
[timers] timer.pause: pause the timer | pause all timers | pause the pasta timer | hold the timer | freeze the oven timer | pause timer 2
[timers] timer.resume: resume the timer | unpause the pasta timer | resume all timers | start the timer again | continue the timer | restart the paused timer
[timers] timer.add: add 2 minutes to the oven timer | add 5 minutes to the timer | put another minute on the pasta | give the rice 3 more minutes | add 30 seconds to the timer | extend the laundry timer by 10 minutes
[timers] timer.rename: call the second timer oven | rename the laundry timer to dryer | name the first timer pasta | change the timer name to rice | call timer 2 cookies
[ringing] timer.dismiss: dismiss the timer | stop the timer | turn off the timer | okay i heard it | silence the timer | stop the ringing | i got it thanks | shut it off
stopwatch: start a stopwatch | start the stopwatch | stop the stopwatch | how long has the stopwatch been running | reset the stopwatch | lap | stopwatch please
alarm.set: set an alarm for 7am | wake me up at 6:30 tomorrow | set an alarm for 5:45 | alarm at 8 | set my alarm for 6 in the morning | set an alarm for noon | wake me at 7 on saturday
alarm.list: what alarms do i have | list my alarms | when is my alarm set for | do i have an alarm tomorrow | show my alarms
alarm.cancel: cancel my alarm | delete the 7am alarm | turn off my alarm for tomorrow | remove all alarms | cancel the alarm
reminder.set: remind me to call mom at 5 | remind me tomorrow to pay the bills | remind me at 8pm to take my pills | set a reminder to buy milk at 6 | don't let me forget to water the plants tonight at 7 | remind me on friday to email the landlord | remind me to take out the trash tomorrow morning
reminder.list: what reminders do i have | list my reminders | what am i supposed to remember | show my reminders | any reminders today
reminder.cancel: cancel the reminder about the bills | delete my reminder | remove the reminder to call mom | cancel all reminders | forget the milk reminder
snooze: snooze | snooze for 10 minutes | five more minutes | snooze it | hit snooze | give me ten more minutes
app.open: open spotify | launch chrome | open notepad | start word | open the calculator | can you open excel | open file explorer | fire up steam | open discord | launch outlook
app.close: close spotify | quit chrome | close notepad | shut down steam | exit discord | kill word
web.open: go to youtube.com | open youtube | open gmail | go to amazon | open facebook | take me to wikipedia | open netflix | go to github.com | pull up google maps
web.search: search the web for pizza near me | google how to tie a tie | look up the capital of australia | search for cheap flights to denver | search online for best running shoes | google who won the game last night | look up how tall is mount everest
file.find: find my resume | where is my tax file | find files named budget | search my files for invoice | look for the lease pdf | where did i save the photos from christmas
file.open: open my documents folder | open downloads | open my resume | open the budget spreadsheet | open my pictures folder | open the lease document
folder.create: make a new folder called taxes | create a folder named school | new folder called recipes on the desktop | make a folder for photos
bible.read: read john 3:16 | read psalm 23 | read me romans 8:28 | what does genesis 1:1 say | read first corinthians 13 | read matthew chapter 5 | read john 3:16 in the esv | read psalm 91 from the king james | read the first chapter of james | read proverbs 3 verses 5 through 6 | read revelation 21:4 | turn to isaiah 40:31 | read luke 2 | read second timothy 1:7
bible.votd: what's the verse of the day | give me a verse | read me today's verse | verse of the day please | share a bible verse | encourage me with a verse
bible.next: read the next verse | keep going | next chapter | read the next chapter | continue reading | read more
bible.versions: what bible versions do you have | can you read the niv | which translations can you read | do you have the esv | what versions of the bible can you read
bible.search: find verses about hope | what does the bible say about anxiety | search the bible for love your neighbor | where in the bible does it talk about forgiveness | find a verse about strength | bible verses about peace
bible.setversion: use the esv from now on | switch to the king james version | change the bible version to nlt | read from the world english bible by default | set my bible to the asv
weather: what's the weather | how's the weather today | is it going to rain | what's the forecast | how hot is it outside | what's the temperature | do i need a jacket | will it rain tomorrow | what's the weather this week | is it cold outside | how windy is it | what's it like outside | should i bring an umbrella | what's the weather on saturday
media.play: play some music | play worship music | play taylor swift | put on some jazz | play my playlist | play lo-fi beats | play the news on youtube | play hillsong | play something relaxing | play some christmas music
media.pause: pause the music | pause | pause the video | hold the music | pause the song
media.resume: resume the music | unpause | keep playing | resume | play the music again | continue the song
media.next: next song | skip this song | skip | next track | play the next one | skip ahead
media.prev: previous song | go back a song | play the last song again | previous track | back one song
media.stop: stop the music | stop playing | turn off the music | stop the video | kill the music
media.volume: turn it up | turn the music down | volume up | volume down | set the volume to 50 | louder music | make the music quieter | turn the volume up a bit
media.now: what song is this | what's playing | who sings this | what's this song called | name this song
ds.stoplistening: stop listening | don't listen right now | mute the mic | quit listening | you can stop listening | turn off the microphone
ds.quiet: be quiet for a while | go quiet | do not disturb | quiet mode | stop announcing things | shush
ds.off: turn yourself off | go to sleep | shut down dayspring | sleep mode | take a break | turn off completely
ds.on: wake up | turn back on | start listening again | i'm back | you can talk again | turn yourself on
ds.compact: compact mode | make the window small | go mini | shrink to the small window | switch to compact | mini mode
ds.fullscreen: go full screen | make it full screen | maximize yourself | full size | make dayspring bigger | show the full app
ds.settings: open settings | show me the settings | go to preferences | change my settings | where are the settings | open setup
ds.help: open help | show me the guide | i need help | how do i use you | open the manual | help me please
ds.helpwith: how do i connect spotify | how do i change the wake word | how can i add my google calendar | how do i set up the tv | how do i turn on notifications | show me how to add a reminder
ds.capabilities: what can you do | what can i ask you | what are your features | what commands do you know | list your skills | what can you do without ai | what should i say
ds.voice: change your voice | use a different voice | list the voices | i want a male voice | switch to a british voice | show me the voices
ds.speed: talk slower | speak faster | slow down | you're talking too fast | speed it up | normal speed please
ds.volume: speak louder | talk softer | i can't hear you | you're too loud | turn your voice down | raise your volume
ds.repeat: repeat that | say that again | what did you say | come again | one more time | i missed that
ds.update: check for updates | is there an update | update yourself | what version are you | are you up to date | install the latest version
ds.sky: make it rain | make it snow | switch to cozy mode | change the sky to sunset | use the forest scene | back to the real weather | make it night | turn off the animations
ds.textonly: text only mode | i'm on a call | typing only | don't talk out loud | silent chat
ds.whoami: who are you | what's your name | what are you | are you a robot | who made you | tell me about yourself
ds.keepawake: keep the laptop awake | don't let the computer sleep | let the computer sleep | keep the screen awake | stop keeping the computer awake
ds.window: move the window to the left | snap the window to the right | move this window to the other screen | resize this window | arrange my windows
persona.be: be a pirate | talk like a cowboy | act like a robot | pretend to be a wizard | be a game show host
persona.normal: be normal | go back to normal | be yourself again | back to your normal personality
persona.what: what personality are you | what character are you right now | who are you pretending to be
jokes.offers: stop asking me about jokes | don't offer jokes anymore | no more joke offers | you can offer jokes again | start offering jokes again
joke: tell me a joke | tell me a dad joke | know any good jokes | make me laugh | tell me a joke about animals | tell me a kids joke | tell me a knock knock joke | another joke | tell me another one | one more joke | a different kind of joke | what kind of jokes do you know | say something funny | tell me a food joke | got any space jokes
knock.start: knock knock | i have a knock knock joke | let me tell you a joke | i've got a joke for you | knock knock dayspring
calc: what's 12 times 14 | what is 15 percent of 80 | 100 divided by 7 | what's 2 plus 2 | square root of 144 | what's 3 to the power of 4 | calculate 45 minus 17 | what's a 20 percent tip on 60 dollars | 7 times 8 | what is 1000 minus 1 | what's 18 percent of 250 | 99 plus 1 | what's half of 350
convert: convert 5 miles to kilometers | how many cups in a quart | what's 100 fahrenheit in celsius | how many ounces in a pound | convert 2 cups to milliliters | how many feet in a mile | 10 kilos in pounds | how many tablespoons in a cup | 350 degrees in celsius | how many grams in an ounce | convert 60 mph to km/h | how many teaspoons in a tablespoon | how many inches in a foot
spell: how do you spell necessary | spell restaurant | how is rhythm spelled | spell the word beautiful | can you spell conscientious
coin: flip a coin | heads or tails | toss a coin | coin flip | flip a coin for me
dice: roll a die | roll the dice | roll two dice | roll a d20 | throw a dice | roll 3 dice
random: pick a random number | give me a random number between 1 and 100 | pick a number from 1 to 10 | random number please | choose a number between 5 and 50
count: count to 10 | count to 100 | count from 5 to 15 | count down from 10 | count backwards from 20 | count by twos to 20 | count by fives to 50 | count by tens to 100 | count to twenty | can you count to 50
fact: tell me a fun fact | give me a random fact | tell me something interesting | did you know anything cool | fact of the day | teach me something
greet.morning: good morning | morning dayspring | good morning to you
greet.night: good night | night night | i'm going to bed | good night dayspring | time for bed
greet.hello: hello | hi | hey there | hi dayspring | hello there | howdy | yo
greet.thanks: thank you | thanks | thanks a lot | thank you so much | appreciate it | nice job
greet.how: how are you | how are you doing | how's it going | how are you today | you doing okay
list.add: add milk to my shopping list | put eggs on the grocery list | add bread and butter to the list | add sunscreen to my packing list | put apples on my shopping list | i need to buy toilet paper | add coffee to the groceries
list.read: what's on my shopping list | read my grocery list | what's on the list | read me the packing list | what do i need from the store | show my shopping list
list.remove: take milk off my shopping list | remove eggs from the grocery list | cross off bread | delete apples from the list | i already got the coffee
list.clear: clear my shopping list | empty the grocery list | delete everything on my list | start a new shopping list | wipe the packing list
note.add: take a note | make a note to call the plumber | write this down buy a birthday card | note that the wifi password is on the router | jot down pick up dry cleaning | remember that i parked on level 3
note.read: read my notes | what are my notes | read me my last note | show my notes | what did i write down
note.delete: delete my last note | remove the note about the plumber | delete that note | erase the last note
todo.add: add call the bank to my to do list | put finish the report on my to do list | add a task to clean the garage | new task water the plants | add pay rent to my tasks
todo.read: what's on my to do list | read my tasks | what do i need to do | what are my to dos | show my task list
texts.read: read my texts | do i have any messages | read my new text | any new text messages | read the last message | who texted me
prayer.read: read my prayer list | who am i praying for | what's on my prayer list | read the prayer requests
prayer.add: add grandma to my prayer list | pray for sarah's surgery | put the smiths on my prayer list | add a prayer request for my job interview
study.next: open my next lesson | what's my next lesson | start studying | continue my course | open the next fs lesson | let's study
discover: show me something new | what did you find for me today | discover something interesting | show me something about woodworking | what's new in my interests
doc.read: read my lease | read the letter from the bank | read me the report | read the document out loud | read my resume to me
doc.summarize: summarize my lease | give me a summary of the report | sum up the letter from the bank | what's in the contract pdf
photos: show me a photo | show my pictures | show me another photo | start a slideshow | show pictures from last christmas
recipe.find: find a recipe for chili | how do i make banana bread | look up a recipe for lasagna | search for chicken soup recipes | find me a pancake recipe | what can i make with chicken and rice | find a recipe with ground beef | i want to make tacos | give me a good brownie recipe | find an easy dinner recipe | recipes for chocolate chip cookies | how to make fried rice
[results] recipe.more: more options | show me more | show me more recipes | any other recipes | next page | different ones
[results] recipe.pick: the second one | number 3 | let's do the first one | the one from allrecipes | the quickest one | save the first one | use the third one | i'll take number 2 | show me details for the second one | save number 4 for later
recipe.cook: let's make pancakes | cook the chili recipe | start cooking the banana bread | let's cook scrambled eggs | make the rice recipe | start the pancakes recipe | make pancakes for 6 people | let's make a double batch of chili
recipe.list: what recipes do i have | show my recipes | open my recipes | list my saved recipes | do i have a recipe for chili | show my favorite recipes
recipe.new: add a new recipe | save a recipe | i want to add a recipe | new recipe called grandma's cookies | let me tell you a recipe | dictate a recipe
recipe.import: import a recipe from allrecipes.com/recipe/123 | save the recipe from this link | import this recipe | grab the recipe from that website
recipe.delete: delete the chili recipe | remove the pancake recipe | get rid of the banana bread recipe | delete my rice recipe
[cooking] cook.next: next step | what's next | next | okay done | go on | ready for the next step | what do i do next | continue
[cooking] cook.prev: previous step | go back | back one step | what was the last step | the step before
[cooking] cook.repeat: repeat the step | say that step again | read the step again | what was that again | repeat
[cooking] cook.where: what step am i on | where are we | how many steps are left | which step is this
[cooking] cook.ingredients: what are the ingredients | read the ingredients | what do i need | list the ingredients again | ingredients please
[cooking] cook.howmuch: how much flour | how much sugar do i need | how many eggs | how much butter goes in | how much milk
[cooking] cook.scale: double the recipe | make it for 8 people | halve the recipe | cut it in half | scale it to 4 servings | triple it
[cooking] cook.stop: stop cooking | we're done cooking | exit cooking mode | i'm finished | close the recipe
[cooking] cook.goto: go to step 3 | skip to step 5 | jump to the last step | go to the first step | step 4
[cooking] cook.timer: start the timer | set a timer for this step | start the step timer | yes start the timer | time this step
social.crisis: i want to hurt myself | i don't want to live anymore | i'm thinking about suicide | i want to end it all | i feel suicidal
social.bored: i'm bored | i'm so bored | there's nothing to do | entertain me | give me something to do | what should i do i'm bored
social.tired: i'm tired | i'm so exhausted | i'm really sleepy | long day | i'm worn out | i need a nap
social.stressed: i'm stressed | i'm so stressed out | i'm feeling anxious | i'm overwhelmed | i'm having a rough day | i need to calm down | everything is too much
social.sad: i'm sad | i'm feeling down | i feel really low | i'm upset | i had a bad day | i want to cry
social.lonely: i'm lonely | i feel so alone | keep me company | talk to me | nobody cares about me
social.happy: i'm so happy | i got the job | i passed my test | good news | today was awesome | i'm really excited
social.love: i love you | do you like me | will you be my friend | you're my best friend | are we friends
social.compliment: good job | great job dayspring | you're awesome | well done | you're so helpful | you rock
social.insult: you're dumb | you're useless | i hate you | shut up | you suck
social.sorry: sorry | my bad | i apologize | oops sorry
social.whatsup: what's up | sup | wassup | what's the craic | what are you up to | howdy y'all | what's new with you
greet.evening: good evening | good afternoon | evening dayspring | happy friday | top of the morning
date.weekday: what day of the week is july 4 | what day is christmas on this year | was january 1st a monday | what day of the week was march 3rd | which day is halloween | what weekday is new year's day
date.leap: is it a leap year | is 2028 a leap year | when is the next leap year | does february have 29 days this year | leap year
date.what: what's the date next friday | what is the date in 3 weeks | what date is next tuesday | what's the date the day after tomorrow | what will the date be in 10 days
dinner.suggest: what should i have for dinner | what's for dinner | dinner ideas | what should i make tonight | i don't know what to cook | help me decide what to eat | what should i eat for lunch
reminder.repeat: remind me to take out the trash every tuesday night | remind me to water the plants every sunday | remind me every day at 9 to check my email | set a weekly reminder to call grandma | remind me to pay rent every month on the first | remind me to walk the dog every morning at 7 | every friday remind me to clean the fridge
health.medicine: remind me to take my medicine at 8 | remind me to take my pills every morning | set a medication reminder for 9pm | remind me to take my vitamins every day at noon | don't let me forget my meds
health.water: remind me to drink water every hour | drink water reminders | help me stay hydrated | set a water reminder every 30 minutes | stop the water reminders
health.stretch: start a stretch break | i need to stretch | time for a stretch break | take a movement break | remind me to stretch
health.breathe: breathing exercise | do a breathing exercise with me | box breathing | help me breathe | breathe with me | help me relax with some deep breaths
focus.start: start a pomodoro | start a focus session | focus mode | i need to focus | start a 50 minute focus session | let's get some work done | begin a work sprint
focus.stop: stop the pomodoro | end my focus session | i'm done focusing | cancel focus mode | end focus
day.done: what did i do today | what have i gotten done today | recap my day | what have i done so far | what did i accomplish today
day.left: what's left today | what else do i have today | anything left today | what's remaining on my schedule | how much do i have left today
ds.restart: restart | restart yourself | reboot dayspring | reload the app | turn yourself off and on again
ds.brightness: turn up the brightness | make the screen brighter | dim the screen | the screen is too dark | lower the brightness
ds.examples: give me some examples | what else can i say | show me some examples | teach me some commands | what should i try
know.capital: what's the capital of france | capital of texas | what is the capital of japan | what city is the capital of australia | what's the capital of new york state | capital of canada
know.planet: how many planets are there | what's the biggest planet | tell me about mars | how many moons does jupiter have | is pluto a planet | name the planets | what is the hottest planet
know.table: what's the 7 times table | 9 times table | multiplication table for 12 | say the 5 times table
know.question: who invented the telephone | why is the sky blue | how does a rainbow form | who was the first president | when did world war 2 end | what does photosynthesis mean | tell me about the roman empire | how far is the moon | who wrote romeo and juliet | where is mount kilimanjaro
game.trivia: let's play trivia | ask me a trivia question | quiz me | trivia time | test my knowledge | another trivia question
game.rps: rock paper scissors | let's play rock paper scissors | i choose rock | rock paper scissors shoot | play roshambo
game.8ball: magic 8 ball will it snow | shake the magic 8 ball | ask the magic 8 ball | magic 8 ball
game.wyr: would you rather | ask me a would you rather | let's play would you rather | another would you rather
game.20q: let's play 20 questions | 20 questions | guess what i'm thinking | let's play i spy | play a guessing game
meta.heard: what did you hear | what did i just say | what did you think i said | did you catch that
meta.wrong: that's wrong | you misheard me | that's not what i said | you got it wrong | that's not what i meant | you misunderstood
meta.nevermind: never mind | forget it | cancel that | start over | scratch that | that's all | nothing else
shopping.search: find a waterproof work boot size 11 under $120 on amazon | is there a 6 outlet smart power strip on amazon | search amazon for coffee filters | does amazon sell cast iron skillets | find me a phone case on amazon | look up desk lamps on amazon | can i buy a kindle on amazon
shopping.orders: show my amazon orders | my amazon order history | where is my amazon package | what did i order on amazon
shopping.lastbought: when did i last buy coffee filters | did i already order paper towels on amazon | search my amazon orders for batteries
shopping.reorder: buy coffee filters again on amazon | reorder paper towels | order dog food again on amazon
shopping.subs: show my subscribe and save | what is coming from subscribe and save | skip the coffee filters delivery | turn off amazon subscription notifications
shopping.account: show my amazon account | am i a prime member | what is my prime status | open my amazon addresses
shopping.open: open shopping | open the shopping panel
shopping.signin: sign in to amazon | sign out of amazon | am i signed in to amazon
`;

// Things that must NOT be read as the look-alike (the matcher's hardest confusions).
export const NEGATIVES = [
  // a number on a list is never the book of Numbers; the Bible needs a Bible phrasing
  ["show number 3", "images.view", "bible.read", {}],
  ["show me number 3", "images.view", "bible.read", {}],
  ["numbers chapter 3", "bible.read", "images.view", {}],
  ["show number 3", "recipe.pick", "bible.read", { recipeResults: true }],
  ["cancel the timer", "timer.cancel", "sched.delete", { timers: true }],
  ["cancel the event", "sched.delete", "timer.cancel", { timers: true }],
  ["cancel the dentist appointment", "sched.delete", "timer.cancel", { timers: true }],
  ["move the meeting to 3pm", "sched.move", "ds.window", {}],
  ["move the window to the left", "ds.window", "sched.move", {}],
  ["pause the music", "media.pause", "timer.pause", { timers: true }],
  ["pause the timer", "timer.pause", "media.pause", { timers: true }],
  ["stop the music", "media.stop", "timer.dismiss", {}],
  ["stop listening", "ds.stoplistening", "media.stop", {}],
  ["what time is it in tokyo", "time.city", "time.now", {}],
  ["what time is it", "time.now", "time.city", {}],
  ["what's next", "sched.next", "cook.next", {}],
  ["next song", "media.next", "cook.next", { cooking: true }],
  ["next step", "cook.next", "media.next", { cooking: true }],
  ["read my notes", "note.read", "doc.read", {}],
  ["read john 3:16", "bible.read", "doc.read", {}],
  ["set an alarm for 7am", "alarm.set", "timer.start", {}],
  ["set a timer for 7 minutes", "timer.start", "alarm.set", {}],
  ["remind me to call mom at 5", "reminder.set", "timer.start", {}],
  ["remind me in 20 minutes to flip the chicken", "timer.start", "reminder.set", {}],
  ["add milk to my shopping list", "list.add", "sched.add", {}],
  // Amazon words that aren't shopping (lib/shopping): music, the website, the shopping list
  ["play amazon music", "media.play", "shopping.search", {}],
  ["go to amazon", "web.open", "shopping.search", {}],
  ["what's on my shopping list", "list.read", "shopping.open", {}],
  ["put eggs on the shopping list", "list.add", "shopping.open", {}],
  ["read psalm 23", "bible.read", "shopping.search", {}],
  ["add dentist friday at 3", "sched.add", "list.add", {}],
  ["turn it up", "media.volume", "ds.volume", {}],
  ["speak louder", "ds.volume", "media.volume", {}],
  ["tell me a joke", "joke", "knock.start", {}],
  ["knock knock", "knock.start", "joke", {}],
  ["how many cups in a quart", "convert", "calc", {}],
  ["what's 12 times 14", "calc", "bible.read", {}],
  ["find a recipe for chili", "recipe.find", "file.find", {}],
  ["find my resume", "file.find", "recipe.find", {}],
  ["open spotify", "app.open", "web.open", {}],
  ["go to youtube.com", "web.open", "app.open", {}],
  ["delete the chili recipe", "recipe.delete", "sched.delete", {}],
  ["count to 10", "count", "calc", {}],
  ["remind me to take out the trash every tuesday", "reminder.repeat", "reminder.set", {}],
  ["remind me to call mom at 5", "reminder.set", "reminder.repeat", {}],
  ["what's the capital of france", "know.capital", "know.question", {}],
  ["who invented the telephone", "know.question", "ds.whoami", {}],
  ["i'm tired", "social.tired", "greet.night", {}],
  ["what day is christmas on", "date.weekday", "date.holiday", {}],
  ["when is christmas", "date.holiday", "date.weekday", {}],
  ["start a pomodoro", "focus.start", "timer.start", {}],
  ["stop the pomodoro", "focus.stop", "timer.cancel", { timers: true }],
  ["i want to die", "social.crisis", "greet.night", {}],
  ["never mind", "meta.nevermind", "media.stop", {}],
  ["that's wrong", "meta.wrong", "calc", {}],
  ["be quiet", "ds.quiet", "persona.be", {}],
  ["be a pirate", "persona.be", "joke", {}],
  ["remind me to drink water at 11pm", "reminder.set", "health.water", {}],
  ["remind me to drink water tomorrow at 6am", "reminder.set", "health.water", {}],
  ["remind me to drink water in 2 hours", "timer.start", "health.water", {}],
  ["remind me to drink water every day at 11pm", "reminder.repeat", "health.water", {}],
];

// Action and details, checked exactly (dry run: nothing is done)
export const ACTIONS = [
  ["set a timer for 10 minutes", { do: "timer.start", ms: 600000, label: "" }],
  ["set a pasta timer for 8 minutes", { do: "timer.start", ms: 480000, label: "pasta" }],
  ["10 minute timer for the laundry", { do: "timer.start", ms: 600000, label: "laundry" }],
  ["remind me in 20 minutes to flip the chicken", { do: "timer.start", ms: 1200000, label: "flip the chicken" }],
  ["set a timer for an hour and a half", { do: "timer.start", ms: 5400000 }],
  ["set a timer for 90 seconds", { do: "timer.start", ms: 90000 }],
  ["cancel the rice timer", { do: "timer.cancel", ref: "rice" }, { timers: true }],
  ["pause all timers", { do: "timer.pause", ref: "all" }, { timers: true }],
  ["add 2 minutes to the oven timer", { do: "timer.add", ms: 120000, ref: "oven" }, { timers: true }],
  ["how long left on the pasta", { do: "timer.left", ref: "pasta" }, { timers: true }],
  ["rename the laundry timer to dryer", { do: "timer.rename", ref: "laundry", to: "dryer" }, { timers: true }],
  ["call the second timer oven", { do: "timer.rename", ref: "second", to: "oven" }, { timers: true }],
  ["what's 15% of 80", { do: "calc" }],
  ["read john 3:16", { do: "bible.read", ref: "John 3:16" }],
  ["read psalm 23 in the esv", { do: "bible.read", ref: "Psalms 23", version: "esv" }],
  ["add milk and eggs to my shopping list", { do: "list.add", list: "shopping", item: "milk and eggs" }],
  ["count to 20", { do: "count", from: 1, to: 20, step: 1, down: false }],
  ["count down from 10", { do: "count", from: 10, to: 1, down: true }],
  ["count by fives to 50", { do: "count", to: 50, step: 5 }],
  ["find a recipe for chili", { do: "recipe.find", dish: "chili" }],
  ["move the dentist to 4pm", { do: "sched.move", what: "dentist", time: "16:00" }],
  ["set an alarm for 6:30am", { do: "alarm.set", time: "06:30" }],
  ["stop asking me about jokes", { do: "jokes.offers", on: false }],
  ["tell me a knock knock joke", { do: "joke", type: "knock" }],
  ["move the window to the left", { do: "needs.ai" }],
  ["remind me to take out the trash every tuesday night", { do: "reminder.repeat", text: "take out the trash", days: [2], time: "20:00" }],
  ["remind me to take my medicine at 8pm", { do: "reminder.repeat", time: "20:00", once: true, medication: true }],
  ["remind me to take my pills every morning", { do: "reminder.repeat", time: "08:00", once: false }],
  ["remind me to drink water every 30 minutes", { do: "health.water", every: 1800000 }],
  ["start a 50 minute focus session", { do: "focus.start", work: 3000000, rest: 300000, rounds: 4 }],
  ["start a pomodoro", { do: "focus.start", work: 1500000 }],
  ["is 2028 a leap year", { do: "date.leap", year: 2028 }],
  ["i choose rock", { do: "game.rps", pick: "rock" }],
  ["what's the 7 times table", { do: "know.table", n: 7 }],
  ["i want to hurt myself", { do: "support", kind: "crisis" }],
  ["remind me in a bit to check the oven", { do: "timer.start", ms: 900000, label: "check the oven" }],
  ["add dentist first thing tomorrow", { do: "sched.add", time: "08:00" }],
  ["what's on the end of the month", { do: "sched.day" }],
  // a clock time or "in 2 hours" is ONE reminder, never the hourly water reminder (1.7.2 made "at 11pm" hourly)
  ["remind me to drink water at 11pm", { do: "reminder.set", text: "drink water", time: "23:00" }],
  ["remind me to drink water at 11 tonight", { do: "reminder.set", text: "drink water", time: "23:00" }],
  ["remind me to drink water at 7:30", { do: "reminder.set", text: "drink water", time: "07:30" }],
  ["remind me to drink water tomorrow at 6am", { do: "reminder.set", text: "drink water", time: "06:00" }],
  ["remind me to drink water in 2 hours", { do: "timer.start", ms: 7200000, label: "drink water" }],
  ["remind me to drink water every hour", { do: "health.water", every: 3600000 }],
  ["remind me to drink water every 30 minutes", { do: "health.water", every: 1800000 }],
  ["remind me to drink water hourly", { do: "health.water", every: 3600000 }],
  ["remind me to drink water every day at 11pm", { do: "reminder.repeat", text: "drink water", days: [0, 1, 2, 3, 4, 5, 6], time: "23:00" }],
  ["help me stay hydrated", { do: "health.water", every: 3600000 }],
];
