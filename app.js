"use strict";
const {init} = require("./lib/server/index");

if (require.main === module) {
  init((app) => {
       app.listen(process.env.PORT || 3000, () => {
         console.log(`Listening on port ${process.env.PORT || 3000}!`);
       });
  });
}
