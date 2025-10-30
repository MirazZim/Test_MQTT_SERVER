const jwt = require("jsonwebtoken");
const User = require("../models/User");

const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await User.comparePassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const register = async (req, res) => {
  const { username, password, role = "user" } = req.body;

  try {
    // Validate role
    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({ error: "Invalid role specified" });
    }

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const userId = await User.create(username, password, role);
    const user = await User.findById(userId);

    res.status(201).json({
      message: "User registered successfully",
      user,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Username already exists" });
    }
    res.status(500).json({ error: err.message });
  }
};

/**
 * Role-based authentication middleware
 * @param {string[]} allowedRoles - Array of allowed roles ('admin', 'user')
 * @returns {function} Middleware function
 */
const authenticate = (allowedRoles = []) => {
  // Validate allowedRoles parameter
  if (!Array.isArray(allowedRoles)) {
    throw new Error("Allowed roles must be an array");
  }

  // Check for invalid roles
  const invalidRoles = allowedRoles.filter(
    (role) => !["admin", "user"].includes(role)
  );
  if (invalidRoles.length > 0) {
    throw new Error(`Invalid roles specified: ${invalidRoles.join(", ")}`);
  }

  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization token required" });
    }

    const token = authHeader.split(" ")[1];
    console.log("🚀 ~ authenticate ~ token:", token);

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Role verification
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        return res.status(403).json({
          error: "Access denied",
          message: `Requires one of these roles: ${allowedRoles.join(", ")}`,
          yourRole: user.role,
        });
      }

      // Attach user to request
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        token, // Optional: attach token if needed
      };

      next();
    } catch (err) {
      // Handle different JWT errors specifically
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired" });
      }
      if (err.name === "JsonWebTokenError") {
        return res.status(401).json({ error: "Invalid token" });
      }
      res.status(500).json({ error: "Authentication failed" });
    }
  };
};

module.exports = {
  login,
  register,
  authenticate,
  // Optional: export specific role middlewares for convenience
  adminOnly: authenticate(["admin"]),
  userOnly: authenticate(["user"]),
  adminOrUser: authenticate(["admin", "user"]),
};
