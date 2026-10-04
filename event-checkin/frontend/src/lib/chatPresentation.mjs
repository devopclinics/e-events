// Member IDs keep a person's color consistent across messages and conversations.
const AUTHOR_COLORS = [
  ['#006b60', '#e5f6f1'], ['#6241aa', '#f0eafa'],
  ['#a62a60', '#fceaf1'], ['#245f9d', '#e8f1fc'],
  ['#8a5510', '#fff3dd'], ['#93432a', '#fbeee7'],
  ['#3e6b29', '#eef6e8'], ['#944084', '#f7eaf6'],
];

export function authorColorStyle(identity) {
  let hash = 0;
  for (const char of String(identity || 'member')) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  const [color, background] = AUTHOR_COLORS[hash % AUTHOR_COLORS.length];
  return { '--fm-author-color': color, '--fm-author-background': background };
}

const category = (id, label, icon, entries) => ({
  id, label, icon,
  emojis: entries.split(';').map((entry) => {
    const [emoji, name] = entry.trim().split('|');
    return { emoji, name };
  }),
});

export const EMOJI_CATEGORIES = [
  category('popular', 'Popular', '⭐', '😊|smile happy;❤️|red heart love;👍|thumbs up yes;😂|laugh tears joy;👏|clap applause;🎉|party celebration;🙏|prayer thanks please;🙌|raised hands hooray;🤝|handshake welcome;👋|wave hello;😍|heart eyes love;🥰|smiling hearts;🤣|rolling laughing;😮|surprised wow;🤗|hug;💯|hundred perfect;✨|sparkles;🎂|birthday cake;🤲|prayer palms;🕌|mosque;🌙|crescent moon;💚|green heart;🎁|gift;✅|check done'),
  category('faces', 'Faces', '😀', '😀|grinning happy;😃|big smile;😄|smiling eyes;😁|beaming grin;😆|laughing squint;😅|sweat smile;😂|laugh tears joy;🤣|rolling laughing;😊|smile happy;🙂|slightly smiling;🙃|upside down;😉|wink;😌|relieved;😍|heart eyes love;🥰|smiling hearts;😘|kiss heart;😗|kissing;😙|kissing smiling;😚|kissing closed eyes;😋|delicious yummy;😛|tongue;😝|tongue squint;😜|wink tongue;🤪|zany silly;🤨|raised eyebrow;🧐|monocle thinking;🤓|nerd glasses;😎|cool sunglasses;🥸|disguise;🤩|star eyes excited;🥳|party face;😏|smirk;😒|unamused;😞|disappointed;😔|sad thoughtful;😟|worried;😕|confused;🙁|frowning;☹️|sad frown;😣|persevering;😖|confounded;😫|tired;😩|weary;🥺|pleading;😢|cry;😭|crying sob;😤|huff proud;😠|angry;😡|pouting angry;🤯|mind blown;😳|flushed embarrassed;🥵|hot;🥶|cold;😱|scream shocked;😨|fearful;😰|anxious sweat;😥|sad relieved;😓|sweat;🤗|hug;🤔|thinking;🫣|peeking;🤭|hand over mouth;🫢|gasp;🫡|salute;🤫|quiet shush;🤥|lying;😶|silent;😐|neutral;😑|expressionless;😬|grimace;🙄|eye roll;😮|surprised wow;😯|hushed;😲|astonished;🥱|yawn;😴|sleep;🤤|drool;😪|sleepy;😵|dizzy;🤐|zip mouth;🥴|woozy;🤢|nauseous;🤧|sneeze;😷|mask;🤒|ill thermometer;🤕|bandage;🤑|money face;🤠|cowboy;😇|angel;🤖|robot;👻|ghost;😺|cat smile;😸|cat grin;😹|cat tears joy;😻|cat heart eyes'),
  category('people', 'People', '👋', '👋|wave hello;🤚|raised back hand;🖐️|hand fingers;✋|raised hand stop;🖖|vulcan salute;👌|okay hand;🤌|pinched fingers;🤏|small pinch;✌️|peace victory;🤞|crossed fingers luck;🤟|love gesture;🤘|rock horns;🤙|call me;👈|point left;👉|point right;👆|point up;👇|point down;☝️|pointing finger;👍|thumbs up yes;👎|thumbs down no;✊|raised fist;👊|fist bump;🤛|left fist;🤜|right fist;👏|clap applause;🙌|raised hands hooray;👐|open hands;🤲|prayer palms;🤝|handshake welcome;🙏|prayer thanks please;💪|strong muscle;🫶|heart hands;👂|ear listen;👀|eyes look;👶|baby;🧒|child;👧|girl;👦|boy;👩|woman;👨|man;🧕|headscarf hijab;👳|turban;👵|grandmother;👴|grandfather;🙋|raise hand question;🙆|okay person;🙅|no person;🤷|shrug;🤦|facepalm;💃|dance;🕺|dancing man;🚶|walking;🏃|running;🧑‍🤝‍🧑|people holding hands;👨‍👩‍👧‍👦|family'),
  category('hearts', 'Hearts', '❤️', '❤️|red heart love;🧡|orange heart;💛|yellow heart;💚|green heart;💙|blue heart;💜|purple heart;🖤|black heart;🤍|white heart;🤎|brown heart;🩷|pink heart;🩵|light blue heart;🩶|grey heart;💔|broken heart;❤️‍🩹|healing heart;❤️‍🔥|heart fire;❣️|heart exclamation;💕|two hearts;💞|revolving hearts;💓|beating heart;💗|growing heart;💖|sparkling heart;💘|cupid arrow heart;💝|heart ribbon;💟|heart decoration;💌|love letter;💋|kiss lips;🌹|rose flower;💐|bouquet flowers'),
  category('celebrate', 'Celebrate', '🎉', '🎉|party celebration;🎊|confetti;🎈|balloon;🎁|gift present;🎂|birthday cake;🧁|cupcake;🥳|party face;🎀|ribbon;🏆|trophy winner;🥇|gold medal;🥈|silver medal;🥉|bronze medal;🏅|medal;🎖️|honor medal;✨|sparkles;🌟|glowing star;⭐|star;💫|dizzy stars;🔥|fire;💯|hundred perfect;🎓|graduation;🎤|microphone;🎵|music note;🎶|music notes;🎸|guitar;🥁|drum;🎺|trumpet;📸|camera flash;📷|camera;🤝|handshake welcome;🕌|mosque;🕋|kaaba;☪️|islam star crescent;🤲|prayer palms;🙏|prayer thanks please;🌙|crescent moon'),
  category('nature', 'Nature', '🌿', '🌿|herb green leaf;🍀|four leaf clover luck;☘️|shamrock;🌱|seedling growth;🌳|tree;🌴|palm tree;🌵|cactus;🌸|cherry blossom;🌺|hibiscus;🌻|sunflower;🌷|tulip;🌼|daisy flower;🌹|rose flower;🍁|maple autumn;🍂|fallen leaves;🍃|leaves wind;🦋|butterfly;🐝|bee;🐞|ladybug;🐦|bird;🕊️|dove peace;🦅|eagle;🐣|hatching chick;🐱|cat;🐶|dog;🐰|rabbit;🦁|lion;🐻|bear;🐼|panda;🐢|turtle;🐬|dolphin;🐟|fish;🌞|sun face;☀️|sun sunny;🌤️|sun cloud;☁️|cloud;🌧️|rain;⛈️|storm;🌈|rainbow;❄️|snowflake;🌊|wave ocean;🌍|earth africa;🌎|earth americas;🌏|earth asia;🌙|crescent moon'),
  category('food', 'Food', '🍽️', '🍽️|meal dinner plate;🍴|fork knife;🥄|spoon;☕|coffee tea;🍵|tea cup;🧃|juice;🥤|drink;💧|water;🍎|apple;🍊|orange fruit;🍋|lemon;🍌|banana;🍉|watermelon;🍇|grapes;🍓|strawberry;🫐|blueberry;🍍|pineapple;🥭|mango;🥑|avocado;🥦|broccoli;🥕|carrot;🌽|corn;🥒|cucumber;🥗|salad;🍞|bread;🥐|croissant;🥯|bagel;🥞|pancakes;🍳|egg cooking;🍕|pizza;🍔|burger;🍟|fries;🥪|sandwich;🌮|taco;🍗|chicken;🍖|meat;🍚|rice;🍛|curry rice;🍜|noodles;🍝|spaghetti;🍲|stew soup;🍿|popcorn;🍪|cookie;🍩|doughnut;🍫|chocolate;🍦|ice cream;🍯|honey;🎂|birthday cake;🥣|bowl;🧂|salt'),
  category('travel', 'Travel', '✈️', '✈️|airplane flight;🛫|flight departure;🛬|flight arrival;🚗|car;🚕|taxi;🚌|bus;🚆|train;🚇|metro;🚲|bicycle;🚶|walking;🏨|hotel;🏠|home;🏙️|city skyline;🏛️|building;🏟️|stadium;🗺️|map;📍|location pin;🧭|compass;🧳|luggage suitcase;⛱️|beach umbrella;🏖️|beach;⛰️|mountain;🎡|ferris wheel;🚦|traffic light;⛽|fuel;🛣️|highway road;🇺🇸|united states usa america;🇳🇬|nigeria;🇨🇦|canada;🇬🇧|united kingdom britain;🇬🇭|ghana;🇸🇦|saudi arabia;🇦🇪|united arab emirates;🇫🇷|france;🇩🇪|germany;🇲🇽|mexico;🇿🇦|south africa;🇸🇳|senegal;🇰🇪|kenya'),
  category('symbols', 'Symbols', '✅', '✅|check done yes;☑️|checkbox;✔️|checkmark;❌|cross no;❎|cross box;⚠️|warning;❗|exclamation important;❓|question;‼️|double exclamation;⁉️|question exclamation;🔔|bell notification;🔕|mute bell;💬|chat speech;🗨️|speech bubble;💭|thought bubble;📣|announcement megaphone;📢|loudspeaker;🔗|link;📎|attachment paperclip;📌|pin;📅|calendar date;⏰|alarm clock;⌚|watch time;⏳|hourglass;📧|email;✉️|envelope;📞|phone;📱|mobile phone;💻|laptop;📚|books learning;📖|open book;📝|note memo;✏️|pencil;🖊️|pen;💡|idea light bulb;🔑|key;🔒|lock;🛡️|shield safety;⚙️|settings;🔍|search;🎯|target;🏀|basketball;⚽|soccer football;🏈|american football;🎾|tennis;🏓|table tennis;♟️|chess;🎮|game;➡️|right arrow;⬅️|left arrow;⬆️|up arrow;⬇️|down arrow;🔄|refresh;🟢|green circle;🔵|blue circle;🟣|purple circle;🟡|yellow circle;🔴|red circle'),
];

export const EMOJIS = [...new Map(EMOJI_CATEGORIES.flatMap((item) => item.emojis).map((item) => [item.emoji, item])).values()];
