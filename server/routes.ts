import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./fixed-storage";
import { insertProductSchema, wishlists } from "@shared/schema";
import { z } from "zod";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
console.log("Twilio Phone Number:", twilioPhoneNumber);
console.log("Twilio Account SID:", process.env.ACCOUNT_SID);
console.log("Twilio Auth Token:", process.env.AUTH_TOKEN);
const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
let OTPorigin="";
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}
function isAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  } 
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: "Not authorized" });
  }
  next();
}
function isMiddleman(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (!req.user.isMiddleman) {
    return res.status(403).json({ message: "Not authorized" });
  }
  next();
}
export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);
  app.get("/api/products", async (req, res, next) => {
    try {
      const products = await storage.getProducts();
      res.json(products);
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/products/:id", async (req, res, next) => {
    try {
      const productId = parseInt(req.params.id, 10);
      if (isNaN(productId) || productId <= 0) {
        return res.status(400).json({ message: "Invalid product ID" });
      }  
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (err) {
      console.error("Error fetching product:", err);
      next(err);
    }
  });
  app.post("/api/products", isAdmin, async (req, res, next) => {
    try {
      const validatedData = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(validatedData);
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid product data", 
          errors: err.errors 
        });
      }
      next(err);
    }
  });
  app.post("/api/send-otp", async (req, res) => {
    const { phoneNumber } = req.body;
  
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }
  
    try {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      OTPorigin=otp;
      await client.messages.create({
        body: `Your OTP is: ${otp}`,
        from: twilioPhoneNumber,
        to: phoneNumber,
      });
      console.log(`Generated OTP for ${phoneNumber}: ${otp}`); // Debugging log
      res.status(200).json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
      console.error("Error sending OTP:", error);
      res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
  })
  app.post("/api/place-order", async (req, res) => {
    const orderDetailsSchema = z.object({
      items: z.array(
        z.object({
          productId: z.number().positive(),
          quantity: z.number().positive(),
          price: z.number().positive(),
        })
      ).nonempty(),
      totalAmount: z.number().positive(),
      shippingAddress: z.string().min(1),
      deliveryDate: z.date().optional(),
    });
  
    const { phoneNumber, otp, orderDetails } = req.body;
    if (!phoneNumber || !otp || !orderDetails) {
      return res.status(400).json({ success: false, message: "Phone number, OTP, and order details are required" });
    }
    try {
      console.log("Verifying OTP for phone number:", phoneNumber, "with code:", otp);
    if(OTPorigin !== otp) {
        return res.status(400).json({ success: false, message: "Invalid OTP" });
      }
      console.log("Validating order details:", orderDetails);
      const validatedOrderDetails = orderDetailsSchema.parse(orderDetails);  
      for (const item of validatedOrderDetails.items) {
        const product = await storage.getProduct(item.productId);
        if (!product || product.stock < item.quantity) {
          return res.status(400).json({ message: `Product ${item.productId} is unavailable or out of stock.` });
        }
      }
      const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Set delivery date to 7 days from now
 if (validatedOrderDetails.items.length === 1) {
            const singleItem = validatedOrderDetails.items[0];
            const singleProduct = await storage.getProduct(singleItem.productId);
            if (!singleProduct || singleProduct.stock < singleItem.quantity) {
                return res.status(400).json({ message: `Product ${singleItem.productId} is unavailable or out of stock.` });
            }
            const order = await storage.createOrderone(
                {
                    userId: req.user?.id ?? (() => { throw new Error("User is not authenticated"); })(),
                    total: validatedOrderDetails.totalAmount,
                    shippingAddress: validatedOrderDetails.shippingAddress,
                    deliveryDate:deliveryDate, // Set delivery date'
                    trackingNumber:phoneNumber,
                },
                validatedOrderDetails.items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    price: item.price,
                }))
            );

            return res.status(200).json({ success: true, message: "Order placed successfully", order });
        }

        const order = await storage.createOrder(
            {
                userId: req.user?.id ?? (() => { throw new Error("User is not authenticated"); })(),
                total: validatedOrderDetails.totalAmount,
                shippingAddress: validatedOrderDetails.shippingAddress,
                deliveryDate:deliveryDate, // Set delivery date
                trackingNumber:phoneNumber,
            },
            validatedOrderDetails.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                price: item.price,
            }))
        );
      res.status(200).json({ success: true, message: "Order placed successfully", order });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: "Invalid order details", errors: error.errors });
      }
      console.error("Error placing order:", error);
      res.status(500).json({ success: false, message: "Failed to place order" });
    }
  });
  app.get("/api/orders/statuschange/:orderId", isMiddleman, async (req, res, next) => {
    try {
      console.log("Fetching order status change...");
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const orderId = parseInt(req.params.orderId, 10);
      const order = await storage.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      console.log("Order details:", order);
      const updatedOrder = await storage.updateOrderStatus(orderId, (order.status ==="processing")?"shipped":"delivered");  
      console.log("Updated order status:", updatedOrder);
      if (!updatedOrder) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(updatedOrder.status);
    } catch (err) {
      next(err);
    }
  });
app.put("/api/products/:id", isAdmin, async (req, res, next) => {
    try {
      const productId = parseInt(req.params.id, 10);
      const validatedData = insertProductSchema.partial().parse(req.body);
      if (validatedData.price !== undefined && validatedData.stock !== undefined) {
        const currentProduct = await storage.getProduct(productId);
        const usersWithProductInWishlist = await storage.getUsersWithProductInWishlist(productId);
        if (currentProduct && validatedData.price !== currentProduct.price) {
          await storage.createPriceHistory({
            productId,
            price: validatedData.price,
          });
          if (validatedData.price < currentProduct.price) {
            if (usersWithProductInWishlist.length > 0) {
              for (const user of usersWithProductInWishlist) {
                console.log(`Notifying user ${user.id} about price drop for product ${productId}`);
                await client.messages.create({
                  body: `Exciting news! The price of "${currentProduct.name}" has been reduced to just $${validatedData.price}. Don't miss this opportunity—check it out now!`,
                  from: twilioPhoneNumber,
                  to: user.phone ?? "Unknown",
                });
              }
            }
          }
        }
        if(currentProduct?.stock===0 && validatedData.stock>0){
            if (usersWithProductInWishlist.length > 0) {
              for (const user of usersWithProductInWishlist) {
                await client.messages.create({
                  body: `Great news! The "${currentProduct.name}" is now available for purchase at just $${validatedData.price}. Don't miss out—grab it before it's gone!`,
                  from: twilioPhoneNumber,
                  to: user.phone ?? "Unknown",
                });
              }
            }
      }
      const updatedProduct = await storage.updateProduct(productId, validatedData);
      if (!updatedProduct) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(updatedProduct);
    }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid product data", 
          errors: err.errors 
        });
      }
      next(err);
    }
  });
  app.delete("/api/products/:id", isAdmin, async (req, res, next) => {
    try {
      const productId = parseInt(req.params.id, 10);
      const success = await storage.deleteProduct(productId);
      if (!success) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().positive(),
        quantity: z.number().positive(),
      })
    )
    .nonempty(),
  totalAmount: z.number().positive(),
});app.post("/api/orders", isAuthenticated, async (req, res, next) => {
  try {
    const { items, totalAmount, shippingAddress,phone,deliveryDate } = req.body;
    console.log("Request body:", req.body);
    const orderSchema = z.object({
      items: z.array(
        z.object({
          productId: z.number().positive(),
          quantity: z.number().positive(),
          price: z.number().positive(),
        })
      ),
      phone: z.string().min(10).max(10),
      totalAmount: z.number().positive(),
      shippingAddress: z.string().min(1),
      deliveryDate: z.date().optional(),
    });
    const parsedData = orderSchema.parse({ items, totalAmount, shippingAddress,phone ,deliveryDate });
    for (const item of parsedData.items) {
      const product = await storage.getProduct(item.productId);
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ message: `Product ${item.productId} is unavailable or out of stock.` });
      }
    }
    const order = await storage.createOrder(
      {
        userId: req.user?.id ?? (() => { throw new Error("User is not authenticated"); })(),
        trackingNumber:parsedData.phone,
        deliveryDate:new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        total: parsedData.totalAmount,
        shippingAddress: parsedData.shippingAddress,
      },
      parsedData.items
    );
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});
  app.get("/api/orders", isAuthenticated, async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const orders = await storage.getOrdersByUser(req.user.id);
      res.json(orders);
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/orders/:orderId", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const orderId = parseInt(req.params.orderId, 10);
      const order = await storage.getOrderById(orderId);
      if (!order || order.userId !== req.user.id) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(order);
    } catch (err) {
      next(err);
    }
  });
    app.put('/api/orders/:orderId/approve', isAdmin, async (req, res, next) => {
    try {
        const orderId = parseInt(req.params.orderId, 10);
        const updatedOrder = await storage.updateOrderStatus(orderId, 'processing');
        if (!updatedOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }
        await storage.assignOrderToMiddleman(orderId);
        res.json({ message: 'Order approved and moved to the middleman dashboard', order: updatedOrder });
    } catch (err) {
        next(err);
    }
});
app.get("/api/Approvedorders", isMiddleman, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const allOrders = await storage.getAllOrdersWithDetails();
    const filteredOrders = allOrders.filter(
      (order) =>
        order.status !== 'pending' && order.middlemanId === req.user?.id
    );
    const ordersWithDetails = filteredOrders.map((order) => ({
      orderId: order.id,
      status: order.status,
      totalAmount: order.total,
      shippingAddress: order.shippingAddress,
      deliveryDate: order.deliveryDate,
      customerDetails: {
        name: order.user?.username || "Unknown",
        address: order.shippingAddress,
        contact: order.trackingNumber || "Unknown",
      },
      products: order.items.map((item) => ({
        productId: item.productId,
        productName: item.product?.name || "Unknown",
        category: item.product?.category || "Uncategorized",
        price: item.price,
        quantity: item.quantity,
      })),
    }));
    res.json(ordersWithDetails);
  } catch (error) {
    console.error("Error fetching approved orders:", error);
    next(error);
  }
});
  app.get("/api/ordersforadmin", isAdmin, async (req, res, next) => {
    try {
      console.log("Admin user:", req.user);
      const orders = await storage.getAllOrdersWithDetails();
      res.json(orders);
      console.log("Orders for admin:", orders);
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/products/:id/price-history", async (req, res, next) => {
    try {
      const productId = parseInt(req.params.id, 10);
      const product = await storage.getProduct(productId);      
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      const priceHistory = await storage.getPriceHistory(productId);
      res.json(priceHistory);
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/wishlist", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }      
      const { productId } = req.body;
      if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
      }
      const product = await storage.getProduct(parseInt(productId, 10));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      const wishlist = await storage.addToWishlist({
        userId: req.user.id,
        productId: parseInt(productId, 10)
      });
      res.status(201).json(wishlist);
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/wishlist", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }      
      const wishlist = await storage.getWishlistsWithProducts(req.user.id);
      res.json(wishlist);
    } catch (err) {
      next(err);
    }
  });
  app.delete("/api/wishlist/:productId", async (req, res, next) => {
    try {
      const productId = parseInt(req.params.productId, 10);
      const success = await storage.removeFromWishlist(req.user?.id ?? (() => { throw new Error("User is not authenticated"); })(), productId);      
      if (!success) {
        return res.status(404).json({ message: "Product not in wishlist" });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
  app.patch("/api/cart/:productId", async (req, res, next) => {
    try {
      console.log("Updating cart item...");
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const productId = parseInt(req.params.productId, 10);
      const { quantity } = req.body;
      if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: "Valid quantity is required" });
      }
      console.log("Product ID:", productId);
      console.log("Quantity:", quantity);
      console.log("User ID:", req.user.id);
      const updatedCartItem = await storage.updateCartItemQuantity(req.user.id, productId, quantity);
      if (!updatedCartItem) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      console.log("Updated cart item:", updatedCartItem);
      res.json(updatedCartItem);
    } catch (err) {
      next(err);
    } });


  app.post("/api/cart", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { productId, quantity } = req.body;
      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({ message: "Product ID and valid quantity are required" });
      }
      console.log("Product ID:", productId);
      console.log("Quantity:", quantity);
      const product = await storage.getProduct(parseInt(productId, 10));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      const cartItem = await storage.addToCart({
        userId: req.user.id,
        productId: parseInt(productId, 10),
        quantity
      });
      res.status(201).json(cartItem);
    } catch (err) {
      next(err);
    }
  }
);
  app.get("/api/cart", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const cart = await storage.getCartItems(req.user.id);
      res.json(cart);
    } catch (err) {
      next(err);
    }
  });
  app.put("/api/cart/:productId", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const productId = parseInt(req.params.productId, 10);
      const { quantity } = req.body;
      if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: "Valid quantity is required" });
      }
      const updatedCartItem = await storage.updateCartItemQuantity(req.user.id, productId, quantity);
      if (!updatedCartItem) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      res.json(updatedCartItem);
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/similar-products/:category", async (req, res, next) => {
    try {
      const category = req.params.category;
      const products = await storage. getProductByCategory(category);
      console.log("Similar products:", products);
      if (products.length === 0) {
        return res.status(404).json({ message: "No similar products found" });
      }
      res.json(products);
    }
    catch (err) {
      next(err);
    }
  });
  app.delete("/api/orders/:orderId", isAuthenticated, async (req, res, next) => {
    try {
      const orderId = parseInt(req.params.orderId, 10);
      const success = await storage.deleteOrder(orderId);
      if (!success) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
  app.delete("/api/cart/:productId", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const productId = parseInt(req.params.productId, 10);
      const success = await storage.removeFromCart(req.user.id, productId);
      if (!success) {
        return res.status(404).json({ message: "Product not in cart" });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
  app.delete("/api/cart", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const success = await storage.clearCart(req.user.id);
      if (!success) {
        return res.status(404).json({ message: "Cart is already empty or user not found" });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
app.get("/api/users", isAdmin, async (req, res, next) => {
    try {
        console.log("Fetching users...");
        const users = await storage.getAllUsers();
        const usersWithDetails = await Promise.all(
            users.map(async (user) => {
                const userDetails = await storage.getUserWithDetails(user.id);
                return {
                    ...user,
                    role: user.isAdmin
                        ? "Admin"
                        : user.isMiddleman
                        ? "Middleman"
                        : "User",
                    wishlistCount: userDetails?.wishlistCount || 0,
                    cartItemCount: userDetails?.cartItemCount || 0,
                    numberOfOrder: userDetails?.numberOfOrder || 0,
                };
            })
        );
        console.log("Users with details:", usersWithDetails);
        res.json({ users: usersWithDetails });
    } catch (err) {
        console.error("Error fetching users:", err);
        next(err);
    }
});
  app.get("/api/user/:id", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const userId = parseInt(req.params.id, 10);
      const user = await storage.getUser(userId);
      const userdetail=await storage.getUserWithDetails(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      console.log("User details:", user);
      console.log("User details with wishlist and cart count:", userdetail);
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        isMiddleman: user.isMiddleman,
        phone: user.phone,
        wishlists: userdetail?.wishlistCount || 0,
        cart: userdetail?.cartItemCount,
        orders: userdetail?.numberOfOrder,
      });
    } catch (err) {
      next(err);
    }
  });
  app.put("/api/user/:id", async (req, res, next) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const userId = parseInt(req.params.id, 10);
      const { username, email, phone } = req.body;
      const updatedUser = await storage.updateUser(userId,  username, email, phone );
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }      
      res.json({
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        isAdmin: updatedUser.isAdmin,
        isMiddleman: updatedUser.isMiddleman,
        phone: updatedUser.phone,
      });
    } catch (err) {
      next(err);
    }
  });
  app.delete("/api/user/:id", isAdmin, async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id, 10);
      const success = await storage.deleteUser(userId);
      if (!success) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/analytics", isAdmin, async (req, res, next) => {
    try {
        console.log("Fetching analytics data...");
        const users = await storage.getAllUsers();
        const totalUsers = users.length;
        const admins = users.filter(user => user.isAdmin).length;
        const middlemen = users.filter( user => user.isMiddleman).length -admins;
        const regularUsers = totalUsers - admins - middlemen;
        const products = await storage.getAllProducts(); // Replace with your method to fetch products
        const totalProducts = products.length;
        const categories = products.reduce((acc: Record<string, number>, product) => {
            const category = product.category || "Uncategorized";
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const productCategories = Object.entries(categories).map(([category, count]) => ({
            category,
            count,
        }));
        const orders = await storage.getAllOrdersWithDetails(); // Replace with your method to fetch orders
        const totalOrders = orders.length;
        const ordersByCategory = orders.reduce((acc: Record<string, number>, order) => {
            order.items.forEach(item => {
                const category = item.product.category || "Uncategorized";
                acc[category] = (acc[category] || 0) + 1;
            });
            return acc;
        }, {} as Record<string, number>);
        const orderCategories = Object.entries(ordersByCategory).map(([category, value]) => ({
            category,
            value,
        }));
       res.json({
            users: {
                totalUsers,
                admins,
                middlemen,
                regularUsers,
            },
            products: {
                totalProducts,
                categories: productCategories,
            },
            orders: {
                totalOrders,
                ordersByCategory: orderCategories,
            },
        });
    } catch (err) {
        console.error("Error fetching analytics data:", err);
        res.status(500).json({ message: "Failed to fetch analytics data" });
    }
});
  const httpServer = createServer(app);
  return httpServer;
}