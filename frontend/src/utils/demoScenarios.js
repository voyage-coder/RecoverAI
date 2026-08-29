export const FAILURE_SCENARIOS = [
  { code: "GATEWAY_TIMEOUT", reason: "Gateway timeout" },
  { code: "INSUFFICIENT_FUNDS", reason: "Insufficient funds" },
  { code: "CARD_DECLINED", reason: "Card declined" },
  { code: "NETWORK_ERROR", reason: "Network error" },
  { code: "BANK_SERVER_ERROR", reason: "Bank server unavailable" },
];

export const DEMO_CUSTOMERS = [
  { name: "Asha Verma", email: "asha@example.com" },
  { name: "Rohan Mehta", email: "rohan@example.com" },
  { name: "Priya Nair", email: "priya@example.com" },
  { name: "Vikram Singh", email: "vikram@example.com" },
  { name: "Neha Kapoor", email: "neha@example.com" },
  { name: "Arjun Desai", email: "arjun@example.com" },
  { name: "Kavya Reddy", email: "kavya@example.com" },
  { name: "Sanjay Iyer", email: "sanjay@example.com" },
  { name: "Meera Joshi", email: "meera@example.com" },
  { name: "Aditya Khan", email: "aditya@example.com" },
  { name: "Divya Patel", email: "divya@example.com" },
  { name: "Karan Malhotra", email: "karan@example.com" },
  { name: "Ananya Gupta", email: "ananya@example.com" },
  { name: "Rahul Choudhury", email: "rahul@example.com" },
  { name: "Isha Banerjee", email: "isha@example.com" },
  { name: "Mohit Agarwal", email: "mohit@example.com" },
  { name: "Pooja Sharma", email: "pooja@example.com" },
  { name: "Nikhil Verma", email: "nikhil@example.com" },
  { name: "Sneha Das", email: "sneha@example.com" },
  { name: "Tarun Bhatt", email: "tarun@example.com" },
];

export function pickScenario(scenarios, index) {
  if (!scenarios.length) return FAILURE_SCENARIOS[0];
  return scenarios[index % scenarios.length];
}

export function pickCustomer(index) {
  return DEMO_CUSTOMERS[index % DEMO_CUSTOMERS.length];
}

export function randomAmountPaise(minRupees, maxRupees) {
  const min = Math.min(minRupees, maxRupees);
  const max = Math.max(minRupees, maxRupees);
  const rupees = Math.floor(Math.random() * (max - min + 1)) + min;
  return rupees * 100;
}

export function batchCustomerEmail(batchId, index) {
  return `batch.${batchId.slice(0, 8)}.${index}@recoverai.demo`;
}
