/**
 * introContent.js
 * Beginner-level intro tasks + curated YouTube video IDs
 * injected at the FRONT of the content-pack for each domain.
 */

const INTRO_TASKS = {
  aiml: [
    { title: 'What is Machine Learning? (Intro)', desc: 'Watch 2 explainer videos on ML. Write a 5-bullet summary: what ML is, how it differs from traditional programming, and supervised vs unsupervised learning.', effort: '~30 min', ytQuery: 'machine learning explained beginners intro 2024' },
    { title: 'Map Real-World AI Applications', desc: 'List 8 real-world AI products (Netflix recommendations, spam filters). For each: identify the input data, the model type, and the output prediction.', effort: '~40 min', ytQuery: 'artificial intelligence real world applications examples explained' },
    { title: 'Set Up Your Python ML Environment', desc: 'Install Python, Jupyter Notebook, NumPy, Pandas, and Scikit-learn. Open a notebook and run a cell importing all of them without errors.', effort: '~45 min', ytQuery: 'python machine learning environment setup jupyter scikit-learn install beginners' },
    { title: 'Explore a Public Dataset on Kaggle', desc: 'Download the Titanic or Iris dataset from Kaggle. Load it with Pandas, print .shape, .head(), .dtypes, and .describe(). Identify missing values.', effort: '~1 hr', ytQuery: 'kaggle dataset pandas explore beginners python tutorial' },
  ],
  webdev: [
    { title: 'How the Web Works — Orientation', desc: 'Research and diagram the full request cycle: browser → DNS → server → HTTP response → rendered HTML. Label each step and the tools involved.', effort: '~30 min', ytQuery: 'how the internet works web request browser DNS HTTP explained beginners' },
    { title: 'Build Your First HTML Page', desc: 'Create a valid HTML5 page with a heading, two paragraphs, an image, a link, and an unordered list. Validate it at validator.w3.org.', effort: '~40 min', ytQuery: 'html crash course absolute beginners tutorial html5 2024' },
    { title: 'Style a Page with CSS Fundamentals', desc: 'Link a CSS file to your HTML page. Apply custom colors, a Google Font, padding, margins, and center content using Flexbox.', effort: '~45 min', ytQuery: 'css crash course beginners 2024 flexbox layout basics' },
    { title: 'Add JavaScript Interactivity', desc: 'Add a button that toggles the background color and shows a personalized greeting. Use querySelector, addEventListener, and classList.', effort: '~1 hr', ytQuery: 'javascript crash course beginners DOM events tutorial 2024' },
  ],
  datascience: [
    { title: 'The Data Science Pipeline — Orientation', desc: 'Draw the 6-stage DS pipeline (collection → cleaning → EDA → modelling → evaluation → deployment). List one tool used at each stage.', effort: '~30 min', ytQuery: 'data science pipeline explained beginners overview 2024' },
    { title: 'Set Up a Data Science Environment', desc: 'Install Anaconda (Python), Jupyter, Pandas, NumPy, Matplotlib, and Seaborn. Create a notebook and import all libraries in one cell.', effort: '~40 min', ytQuery: 'anaconda jupyter pandas numpy setup data science beginners tutorial' },
    { title: 'Load and Inspect the Titanic Dataset', desc: 'Download the Titanic CSV from Kaggle. Load with Pandas. Print: shape, column names, dtypes, null counts, and a .describe() summary.', effort: '~45 min', ytQuery: 'pandas load dataset explore titanic python beginners tutorial' },
    { title: 'Create Your First Data Visualization', desc: 'Using the Titanic dataset, plot a histogram of passenger ages and a bar chart of survival rate by class using Matplotlib and Seaborn.', effort: '~1 hr', ytQuery: 'matplotlib seaborn data visualization beginners python tutorial' },
  ],
  robotics: [
    { title: 'What is Robotics? — Core Concepts', desc: 'Research: actuators, sensors, microcontrollers, and control loops. Draw a feedback control loop diagram for a line-following robot.', effort: '~30 min', ytQuery: 'introduction to robotics core concepts beginners explained overview' },
    { title: 'Set Up Arduino IDE and Blink an LED', desc: 'Install Arduino IDE, connect an Arduino Uno via USB, and upload the built-in Blink sketch. Confirm the onboard LED blinks every second.', effort: '~40 min', ytQuery: 'arduino tutorial beginners setup IDE blink LED first project 2024' },
    { title: 'Read a Sensor with the Serial Monitor', desc: "Wire a push-button to Arduino pin 2. Print 'PRESSED'/'RELEASED' to the Serial Monitor using digitalRead().", effort: '~45 min', ytQuery: 'arduino serial monitor sensor digitalRead beginners tutorial' },
    { title: 'Control an LED with a Potentiometer', desc: 'Connect a potentiometer to an analog pin. Map its value (0-1023) to LED brightness using analogWrite() with PWM.', effort: '~1 hr', ytQuery: 'arduino potentiometer LED brightness PWM analogWrite beginners' },
  ],
  iot: [
    { title: 'What is IoT? — Ecosystem Overview', desc: 'Map the 5 IoT layers: sensor → microcontroller → network → cloud → application. Give a real example at each layer.', effort: '~30 min', ytQuery: 'what is internet of things IoT explained beginners overview 2024' },
    { title: 'Set Up Arduino IDE for ESP32', desc: "Install ESP32 board support in Arduino IDE. Upload a 'Hello World' serial print sketch and confirm output at 115200 baud.", effort: '~40 min', ytQuery: 'ESP32 arduino IDE setup install beginners tutorial first project' },
    { title: 'Blink an LED on ESP32', desc: 'Wire an LED to GPIO2 via a 220Ω resistor. Write a sketch that blinks it every 500ms. Log each state over Serial.', effort: '~45 min', ytQuery: 'ESP32 blink LED GPIO beginners arduino tutorial 2024' },
    { title: 'Read a DHT11 Temperature Sensor', desc: 'Wire a DHT11 to your ESP32. Install the DHT library. Print temperature and humidity to the Serial Monitor every 2 seconds.', effort: '~1 hr', ytQuery: 'ESP32 DHT11 temperature humidity sensor arduino beginner tutorial' },
  ],
  cybersec: [
    { title: 'Cybersecurity Fundamentals — Orientation', desc: 'Research the CIA Triad (Confidentiality, Integrity, Availability). Give a real-world breach example for each and explain how it was violated.', effort: '~30 min', ytQuery: 'cybersecurity fundamentals CIA triad explained beginners 2024' },
    { title: 'Set Up a Safe Ethical Hacking Lab', desc: 'Install VirtualBox and download Kali Linux. Boot Kali in a VM. Confirm networking works by pinging an IP. Document each step with screenshots.', effort: '~45 min', ytQuery: 'kali linux virtualbox setup ethical hacking lab beginners 2024' },
    { title: 'Run Your First Network Scan with Nmap', desc: 'Inside Kali VM, run nmap -sV on localhost and your local network range. Identify open ports and running services.', effort: '~45 min', ytQuery: 'nmap tutorial beginners network scanning ethical hacking 2024' },
    { title: 'Crack a Password Hash with Hashcat', desc: 'Generate an MD5 hash of a simple password. Use Hashcat with rockyou.txt to crack it. Explain why MD5 is insecure.', effort: '~1 hr', ytQuery: 'hashcat beginners password cracking ethical hacking MD5 tutorial' },
  ],
};

/** Curated YouTube video IDs for intro items (ordered to match tasks above) */
const INTRO_VIDS = {
  aiml:        ['rfscVS0vtbw', 'Gv9_4yMHFhI', 'ZyhVh-qRZPA', 'ukzFI9rgwfU'],
  webdev:      ['UB1O30fR-EE', 'yfoY53QXEnI', 'hdI2bqOjy3c', 'W6NZfCO5SIk'],
  datascience: ['vmEHCJofslg', 'ua-CiDNNj30', 'RBSUwFGa6Fk', 'HXV3zeQKqGY'],
  robotics:    ['fJWR7dBuc18', 'kUHmYKWwuWs', 'rfscVS0vtbw', 'Gv9_4yMHFhI'],
  iot:         ['t_ispmWmdjY', 'fJWR7dBuc18', 'kUHmYKWwuWs', 'rfscVS0vtbw'],
  cybersec:    ['qiQR5rTSshw', 'WnN6dbos5u8', 'nzZkKoREEGo', 'inWWhr5tnEA'],
};

const INTRO_CHANNELS = {
  aiml:        ['CS Dojo', 'Simplilearn', 'Charming Data', 'Programming w/ Mosh'],
  webdev:      ['freeCodeCamp', 'Traversy Media', 'Traversy Media', 'Dave Gray'],
  datascience: ['Keith Galli', 'Simplilearn', 'freeCodeCamp', 'freeCodeCamp'],
  robotics:    ['DroneBot Workshop', 'DroneBot Workshop', 'CS Dojo', 'Simplilearn'],
  iot:         ['Andreas Spiess', 'DroneBot Workshop', 'DroneBot Workshop', 'CS Dojo'],
  cybersec:    ['freeCodeCamp', 'NeuralNine', 'Tech With Tim', 'NetworkChuck'],
};

/**
 * Returns an array of content-pack items (video+task pairs) for the intro
 * section of a given domain's Beginner pool.
 *
 * @param {string} skillKey  - normalised skill key e.g. 'aiml', 'webdev'
 * @returns {{ task: object, video: object }[]}
 */
function getIntroItems(skillKey) {
  const tasks    = INTRO_TASKS[skillKey]    || INTRO_TASKS.aiml;
  const vidIds   = INTRO_VIDS[skillKey]     || INTRO_VIDS.aiml;
  const channels = INTRO_CHANNELS[skillKey] || [];

  return tasks.map((t, i) => {
    const vid = vidIds[i] || vidIds[0];
    const ch  = channels[i] || 'Intro / Explainer';
    return {
      task: {
        id:     `intro-${skillKey}-${i}`,
        title:  t.title,
        desc:   t.desc,
        effort: t.effort,
        domain: skillKey,
        level:  'Beginner',
        source: 'intro',
        ytQuery: t.ytQuery,
      },
      video: {
        id:        vid,
        videoId:   vid,
        title:     `🎓 INTRO: ${t.title}`,
        channel:   ch,
        thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
        embedUrl:  `https://www.youtube.com/embed/${vid}`,
        watchUrl:  `https://www.youtube.com/watch?v=${vid}`,
        source:    'intro',
      },
    };
  });
}

module.exports = { getIntroItems };
