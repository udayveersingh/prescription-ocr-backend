const users = []; // temporary storage (later replace with DB)

const createUser = (user) => {
    console.log("user coming here ;;;;;", user);
  users.push(user);
  return user;
};

const findUserByEmail = (email) => {
  return users.find((u) => u.email === email);
};

module.exports = {
  createUser,
  findUserByEmail,
};