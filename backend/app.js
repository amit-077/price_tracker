const express = require("express");
const app = express();
const puppeteer = require("puppeteer");
const cors = require("cors");
const { trackModel } = require("./models/trackProduct");
const dotenv = require("dotenv");
var cron = require("node-cron");
const nodemailer = require("nodemailer");
const { connectDB } = require("./connectDB");
const { default: mongoose } = require("mongoose");
const { sendVerificationMail } = require("./mail-sender/sendMail");
const path = require("path");
dotenv.config();
app.use(express.json());

// Database connection
connectDB();

app.use(
  cors({
    origin: [""],
    methods: ["POST", "GET"],
    credentials: true,
  })
);

const flipkartFetch = async (link) => {
  try {
    if (link.includes("flipkart")) {
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(link);

      const flipkartData = await page.evaluate(() => {
        const title =
          document.getElementsByClassName("B_NuCI")[0]?.innerText || null;
        const price1 =
          document.getElementsByClassName("_16Jk6d")[0]?.innerText || null;
        const image =
          document.getElementsByClassName("_2amPTt")[0]?.src || null;
        const rating =
          document.getElementsByClassName("_3LWZlK")[0]?.innerText || null;
        const raters_and_reviews =
          document.getElementsByClassName("_2_R_DZ")[0]?.innerText || null;
        const bestSeller =
          document.getElementsByClassName("_220jKJ")[0]?.innerText || null;

        const description =
          document.getElementsByClassName("_1mXcCf")[0]?.innerText || null;

        let numPrice = price1.replace("₹", "");
        numPrice = numPrice.replace(",", "");
        numPrice = Number(numPrice);

        //
        return {
          from: "flipkart",
          title: title,
          showingPrice: price1,
          price: numPrice,
          image: image,
          rating: rating,
          raters: raters_and_reviews,
          bestSeller: bestSeller,
          description: description,
        };
      });

      await browser.close();
      return flipkartData;
    } else if (link.includes("amazon")) {
      const browser = await puppeteer.launch(
        { headless: true },
        { executablePath: `/path/to/Chrome` }
      );
      const page = await browser.newPage();
      await page.goto(link, { waitUntil: "domcontentloaded" });

      const amazonData = await page.evaluate(async () => {
        const title =
          document.getElementById("productTitle")?.innerText || null;
        const price1 =
          document.getElementsByClassName("a-price-whole")[0]?.innerText ||
          null;
        const image =
          document.getElementsByClassName("a-dynamic-image")[0]?.src || null;
        const rating =
          document.querySelectorAll("span.a-size-base.a-color-base")[1]
            ?.innerText || null;
        const raters_and_reviews =
          document.getElementById("acrCustomerReviewText")?.innerText || null;

        const bestSeller =
          document.getElementsByClassName("p13n-best-seller-badge")[0]
            ?.innerText || null;

        const description =
          document.getElementsByClassName(
            "a-unordered-list a-vertical a-spacing-mini"
          )[0]?.innerText || null;

        let numPrice = "";
        if (price1) {
          numPrice = price1.replace("₹", "");
          numPrice = numPrice.replace(",", "");
          numPrice = numPrice.replace(".", "");
          numPrice = numPrice.replace("\n", "");
          numPrice = Number(numPrice);
        }

        return {
          from: "amazon",
          title: title,
          showingPrice: price1,
          price: numPrice,
          image: image,
          rating: rating,
          raters: raters_and_reviews,
          bestSeller: bestSeller,
          description: description,
        };
      });

      await browser.close();
      return amazonData;
    }
  } catch (e) {
    console.log(e);
  }
};

app.post("/productLink", async (req, res) => {
  try {
    let link = req.body.productLink;
    let data = await flipkartFetch(link);
    if (!data.title) {
      console.log("Amazon no response");
      res.status(400).send();
    } else {
      data.productLink = link;
      res.status(200).send(data);
    }
  } catch (e) {
    console.log(e);
  }
});

app.post("/addProduct", async (req, res) => {
  try {
    let { data, mail } = req.body;

    let result = await trackModel.create({
      userMail: mail,
      productLink: data.productLink,
      productName: data.title,
      productPrice: data.price,
    });

    if (result) {
      res.status(200).send();
    }
  } catch (e) {
    console.log(e);
  }
});

// To fetch price every 8 hours

const checkCurrentFlipkartPrice = async (link) => {
  try {
    const browser = await puppeteer.launch(
      { headless: true },
      { executablePath: `/path/to/Chrome` }
    );
    const page = await browser.newPage();
    let x = await page.goto(link, { timeout: 0 });

    const flipkartData = await page.evaluate(() => {
      const price1 = document.getElementsByClassName("_16Jk6d")[0].innerText;
      let numPrice = price1.replace("₹", "");
      numPrice = numPrice.replace(",", "");
      numPrice = Number(numPrice);

      //
      return {
        price: numPrice,
      };
    });

    await browser.close();
    return flipkartData;
  } catch (e) {
    console.log(e);
  }
};

const checkCurrentAmazonPrice = async (link) => {
  try {
    const browser = await puppeteer.launch(
      { headless: true },
      { executablePath: `/path/to/Chrome` }
    );
    const page = await browser.newPage();
    let x = await page.goto(link, { timeout: 0 });

    const amazonData = await page.evaluate(() => {
      const price1 =
        document.getElementsByClassName("a-price-whole")[0]?.innerText || null;

      let numPrice = null;
      if (price1) {
        numPrice = price1.replace("₹", "");
        numPrice = numPrice.replace(",", "");
        numPrice = numPrice.replace(".", "");
        numPrice = numPrice.replace("\n", "");
        numPrice = Number(numPrice);
      }

      //
      return {
        price: numPrice,
      };
    });

    await browser.close();
    return amazonData;
  } catch (e) {
    console.log(e);
  }
};

const updateDatabase = async (id, newPrice) => {
  try {
    let data = await trackModel.findByIdAndUpdate(id, {
      productPrice: newPrice,
    });

    return data;
  } catch (e) {
    console.log(e);
  }
};

// Check prices every 8 hours

const checkUpdates = async () => {
  try {
    let data = await trackModel.find();

    data.map(async (e) => {
      let { price } = e.productLink.includes("flipkart")
        ? await checkCurrentFlipkartPrice(e.productLink)
        : await checkCurrentAmazonPrice(e.productLink);

      const newPrice = price;
      const oldPrice = e.productPrice;

      if (price && newPrice < oldPrice) {
        sendVerificationMail(
          e.userMail,
          e.productName,
          oldPrice,
          newPrice,
          e.productLink
        );
        await updateDatabase(e._id, newPrice);
      } else {
        console.log(
          e.productLink.includes("flipkart")
            ? "No price update flipkart"
            : "No price update amazon"
        );
      }
    });
  } catch (e) {
    console.log(e);
  }
};

// cron job

//  every 8 hours
cron.schedule("0 */8 * * *", async () => {
  checkUpdates();
});

// get requests

app.get("/getTracks", async (req, res) => {
  let data = await trackModel.find();
  res.send(data);
});

app.get("/deleteAllTracks", async (req, res) => {
  await trackModel.deleteMany();
  res.send("Deleted All Track records");
});

app.get("/deleteOneTrack/:id", async (req, res) => {
  await trackModel.deleteOne({ _id: req.params.id });
  res.send("Deleted record");
});

app.listen(5000, () => {
  console.log("Listening on port 5000");
});
