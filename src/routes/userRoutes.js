// const express = require("express");
// const router = express.Router();
// const authenticate = require("../middleware/auth");
// const { getAllUsers } = require("../controllers/userController");

// router.get("/", authenticate.adminOnly, getAllUsers);

// module.exports = router;


// const express = require("express");
// const authenticate = require("../middleware/auth");
// const { getAllUsers } = require("../main/users/get-all-users");


// const userRouter = express.Router();

// userRouter.get("/", authenticate.adminOnly, async (req, res) => {
//     getAllUsers()
//         .then((data) => {
//             return res.status(200).send({
//                 status: data.status,
//                 message: data.message,
//                 users: data.users,
//             });
//         })
//         .catch((error) => {
//             return res.status(400).send({
//                 status: error.status,
//                 message: error.message,
//             });
//         });
// });

// module.exports = userRouter;
const express = require("express");
const authenticate = require("../middleware/auth");
const { getAllUsers } = require("../main/users/get-all-users");

const userRouter = express.Router();

userRouter.get("/users", authenticate.adminOnly, async (req, res) => {
    getAllUsers()
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
                users: data.users,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

module.exports = userRouter;
