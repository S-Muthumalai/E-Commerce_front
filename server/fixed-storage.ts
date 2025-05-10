import { 
  users, type User, type InsertUser, 
  products, type Product, type InsertProduct, 
  priceHistory, type PriceHistory, type InsertPriceHistory, 
  wishlists, type Wishlist, type InsertWishlist,
  cartItems, type CartItem, type InsertCartItem,
  orders, type Order, type InsertOrder,
  orderItems, type OrderItem, type InsertOrderItem
} from "@shared/schema";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import connectPg from "connect-pg-simple";
import session from "express-session";
import { pool } from "./db";
const PostgresSessionStore = connectPg(session);
export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(userId: number,username:string, phone: string,email: string): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  getAllUsers(): Promise<User[]>;
  getUserWithDetails(id: number): Promise<( { wishlistCount: number, cartItemCount: number ,numberOfOrder:number}) | undefined>;
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;
  getAllProducts(): Promise<Product[]>;
  getProductByCategory(category: string): Promise<Product[]>;
  getPriceHistory(productId: number): Promise<PriceHistory[]>;
  createPriceHistory(priceHistory: InsertPriceHistory): Promise<PriceHistory>;
  getWishlists(userId: number): Promise<Wishlist[]>;
 getWishlistsWithProducts(userId: number): Promise<(Wishlist & { product: Product })[]>;
  addToWishlist(wishlist: InsertWishlist): Promise<Wishlist>;
  getUsersWithProductInWishlist(productId: number): Promise<User[]>;
  removeFromWishlist(userId: number, productId: number): Promise<boolean>;
  getCartItems(userId: number): Promise<(CartItem & { product: Product })[]>;
  addToCart(cartItem: InsertCartItem): Promise<CartItem>;
  updateCartItemQuantity(userId: number, productId: number, quantity: number): Promise<CartItem | undefined>;
  removeFromCart(userId: number, productId: number): Promise<boolean>;
  clearCart(userId: number): Promise<boolean>; 
 createOrder(order: InsertOrder, items: Omit<InsertOrderItem, 'orderId'>[]): Promise<Order>;
  getOrders(userId: number): Promise<Order[]>;
  getOrder(orderId: number): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined>;
  updateOrderStatus(orderId: number, status: Order['status']): Promise<Order | undefined>;
  getAllOrdersWithDetails(): Promise<Order[]>;
  deleteOrder(orderId: number): Promise<boolean>;
  getApprovedOrders(user_id:number): Promise<Order[]>;
  assignOrderToMiddleman(orderId: number): Promise<void>;
 sessionStore: session.Store;
}
export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;
  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool,
      createTableIfMissing: true
    });
  }
  async getProductByCategory(category: string): Promise<Product[]> {
    if (!category) {
      throw new Error("Category must be provided");
    }
    return await db
      .select()
      .from(products)
      .where(eq(products.category, category));
  }

  async getUsersWithProductInWishlist(productId: number): Promise<User[]> {
    const wishlistsWithUsers = await db
      .select({
        userId: wishlists.userId,
        username: users.username,
        email: users.email,
        phone: users.phone,
      })
      .from(wishlists)
      .innerJoin(users, eq(wishlists.userId, users.id))
      .where(eq(wishlists.productId, productId));
    return wishlistsWithUsers.map((wishlist) => ({
      id: wishlist.userId,
      username: wishlist.username,
      email: wishlist.email,
      phone: wishlist.phone,
    })) as User[];
  }
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }
  async getUserWithDetails(id: number): Promise<( { wishlistCount: number; cartItemCount: number; numberOfOrder: number; }) | undefined> {
    const [wishlistCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(wishlists)
      .where(eq(wishlists.userId, id));
    const [cartItemCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(cartItems)
      .where(eq(cartItems.userId, id));
    const [numberOfOrder] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.userId, id));
    return {
      wishlistCount: wishlistCount?.count || 0,
      cartItemCount: cartItemCount?.count || 0,
      numberOfOrder: numberOfOrder?.count || 0,
    };
  }
  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return result !== null;
  }
  async updateUser(userId: number, username: string, phone: string, email: string): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ username, phone, email })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser || undefined;
  }
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values({ ...insertUser, id: sql`DEFAULT` }).returning();
    return user;
  }
  async getProducts(): Promise<Product[]> {
    return await db.select().from(products);
  }
  async getProduct(id: number): Promise<Product | undefined> {
    if(!id||id<=0){
      throw new Error("Invalid product ID");
    }
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }
  async getAllProducts(): Promise<Product[]> {
    try {
        const products1 = await db.select().from(products); // Replace `productsTable` with your actual table name
        return products1;
    } catch (error) {
        console.error("Error fetching products:", error);
        throw new Error("Failed to fetch products");
    }
}
  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    await this.createPriceHistory({
      productId: insertProduct.id,
      price: insertProduct.price,
      date: new Date(),
    }); 
    return product;
  }
  async updateProduct(id: number, updateData: Partial<InsertProduct>): Promise<Product | undefined> {
    const [existingProduct] = await db.select().from(products).where(eq(products.id, id));
    if (!existingProduct) {
      return undefined;
    }
    if (updateData.price !== undefined && updateData.price !== existingProduct.price) {
     await this.createPriceHistory({
        productId: id,
        price: updateData.price,
        date: new Date(),
      });
    }
    const [updatedProduct] = await db
      .update(products)
      .set(updateData)
      .where(eq(products.id, id))
      .returning(); 
    return updatedProduct;
  }
  async deleteProduct(id: number): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.id, id));
    return result !== null;
  }
  async getPriceHistory(productId: number): Promise<PriceHistory[]> {
    return await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.productId, productId))
      .orderBy(priceHistory.date);
  }
  async createPriceHistory(insertPriceHistory: InsertPriceHistory): Promise<PriceHistory> {
    const [entry] = await db
      .insert(priceHistory)
      .values({ ...insertPriceHistory, id: sql`DEFAULT` })
      .returning();  
    return entry;
  }
  async getWishlists(userId: number): Promise<Wishlist[]> {
    return await db
      .select()
      .from(wishlists)
      .where(eq(wishlists.userId, userId));
  }
  async getWishlistsWithProducts(userId: number): Promise<(Wishlist & { product: Product })[]> {
    const userWishlists = await this.getWishlists(userId);
    const result: (Wishlist & { product: Product })[] = [];
    for (const wishlist of userWishlists) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, wishlist.productId)); 
      if (product) {
        result.push({
          ...wishlist,
          product,
        });
      }
    }
    return result;
  }
  async addToWishlist(insertWishlist: InsertWishlist): Promise<Wishlist> {
    const [existing] = await db
      .select()
      .from(wishlists)
      .where(
        and(
          eq(wishlists.userId, insertWishlist.userId),
          eq(wishlists.productId, insertWishlist.productId)
        )
      );
    if (existing) {
      return existing;
    }
    const [wishlist] = await db
      .insert(wishlists)
      .values({ ...insertWishlist, id: sql`DEFAULT` })
      .returning(); 
    return wishlist;
  }
  async removeFromWishlist(userId: number, productId: number): Promise<boolean> {
    const result = await db
      .delete(wishlists)
      .where(
        and(
          eq(wishlists.userId, userId),
          eq(wishlists.productId, productId)
        )
      ); 
    return result !== null;
  }
  async getCartItems(userId: number): Promise<(CartItem & { product: Product })[]> {
    const userCartItems = await db
      .select()
      .from(cartItems)
      .where(eq(cartItems.userId, userId));
    const result: (CartItem & { product: Product })[] = [];
    for (const cartItem of userCartItems) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, cartItem.productId)); 
      if (product) {
        result.push({
          ...cartItem,
          product,
        });
      }
    } 
    return result;
  }
  async addToCart(insertCartItem: InsertCartItem): Promise<CartItem> {
    const [existingItem] = await db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.userId, insertCartItem.userId),
          eq(cartItems.productId, insertCartItem.productId)
        )
      );
    if (existingItem) {
     return await this.updateCartItemQuantity(
        insertCartItem.userId,
        insertCartItem.productId,
        existingItem.quantity + (insertCartItem.quantity || 1)
      ) as CartItem;
    }
    const [cartItem] = await db
      .insert(cartItems)
      .values({ ...insertCartItem, id: sql`DEFAULT` })
      .returning(); 
    return cartItem;
  }
  async updateCartItemQuantity(userId: number, productId: number, quantity: number): Promise<CartItem | undefined> {
    if (quantity <= 0) {
      await this.removeFromCart(userId, productId);
      return undefined;
    }  
     const [updatedCartItem] = await db
      .update(cartItems)
      .set({ quantity })
      .where(
        and(
          eq(cartItems.userId, userId),
          eq(cartItems.productId, productId)
        )
      )
      .returning(); 
    return updatedCartItem;
  }
  async removeFromCart(userId: number, productId: number): Promise<boolean> {
    const result = await db
      .delete(cartItems)
      .where(
        and(
          eq(cartItems.userId, userId),
          eq(cartItems.productId, productId)
        )
      ); 
    return result !== null;
  }
  async clearCart(userId: number): Promise<boolean> {
    const result = await db
      .delete(cartItems)
      .where(eq(cartItems.userId, userId));
    
    return result !== null;
  }
  async getOrderById(orderId: number): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) {
      return undefined;
    }
    const orderItemsList = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const items: (OrderItem & { product: Product })[] = [];
    for (const item of orderItemsList) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId));
      if (product) {
        items.push({
          ...item,
          product,
        });
      }
    }
    return {
      ...order,
      items,
    };
  }
  async getOrdersByUser(userId: number): Promise<(Order & { items: (OrderItem & { product: Product })[] })[]> {
    const userOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(sql`${orders.createdAt} DESC`);
    const result: (Order & { items: (OrderItem & { product: Product })[] })[] = [];
    for (const order of userOrders) {
      const orderItemList = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id)); 
      const items: (OrderItem & { product: Product })[] = [];
      for (const item of orderItemList) {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, item.productId));
        if (product) {
          items.push({
            ...item,
            product,
          });
        }
      }
      result.push({
        ...order,
        items,
      });
    }
    return result;
  }
    async createOrder(orderData: InsertOrder, items: Omit<InsertOrderItem, "orderId">[]): Promise<Order> {
      return await db.transaction(async (tx) => {
        const deliveryDate =new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default to 7 days from now
        const [order] = await tx.insert(orders).values({
          id: sql`DEFAULT`,
          userId: orderData.userId,
          total: orderData.total,
          shippingAddress: orderData.shippingAddress,
          trackingNumber: orderData.trackingNumber,
          deliveryDate, // Assuming you have a function to calculate delivery date
        }).returning();
        for (const item of items) {
          await tx.insert(orderItems).values({
            id: sql`DEFAULT`,
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          });
          await tx
            .update(products)
            .set({ stock: sql`${products.stock} - ${item.quantity}` })
            .where(eq(products.id, item.productId));
        }
        await tx.delete(cartItems).where(eq(cartItems.userId, orderData.userId));
        return order;
      });
    }
    async createOrderone(orderData: InsertOrder, items: Omit<InsertOrderItem, "orderId">[]): Promise<Order> {
      return await db.transaction(async (tx) => {
        const deliveryDate = orderData.deliveryDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default to 7 days from now
        const [order] = await tx.insert(orders).values({
            id: sql`DEFAULT`,
          userId: orderData.userId,
            total: orderData.total,
            shippingAddress: orderData.shippingAddress,
            deliveryDate, 
            trackingNumber: orderData.trackingNumber,
        }).returning();
        for (const item of items) {
          await tx.insert(orderItems).values({
            id: sql`DEFAULT`,
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          });
        await tx
            .update(products)
            .set({ stock: sql`${products.stock} - ${item.quantity}` })
            .where(eq(products.id, item.productId));
        }
     return order;
      });
    }
  async getOrders(userId: number): Promise<Order[]> {
    return await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(sql`${orders.createdAt} DESC`);
  }
  async getOrder(orderId: number): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) {
      return undefined;
    }
    const orderItemList = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const items: (OrderItem & { product: Product })[] = [];
    for (const item of orderItemList) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId));   
      if (product) {
        items.push({
          ...item,
          product,
        });
      }
    } 
    return {
      ...order,
      items,
    };
  }
  async getAllOrdersWithDetails(): Promise<(Order & { 
    items: (OrderItem & { product: Product })[], 
    user: { username: string } 
})[]> {
    // Fetch all orders with user details
    const allOrders = await db
        .select({
            id: orders.id,
            userId: orders.userId,
            status: orders.status,
            createdAt: orders.createdAt,
            deliveryDate: orders.deliveryDate,
            shippingAddress: orders.shippingAddress,
            trackingNumber: orders.trackingNumber,
            total: orders.total,
            updatedAt: orders.updatedAt,
            middlemanId: orders.middlemanId,
            username: users.username, // Include the username from the users table
        })
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id)) // Join with users table
        .orderBy(sql`${orders.createdAt} DESC`); // Order by creation date

    const result: (Order & { 
        items: (OrderItem & { product: Product })[], 
        user: { username: string } 
    })[] = [];
    for (const order of allOrders) {
        const orderItemsList = await db
            .select({
                id: orderItems.id,
                orderId: orderItems.orderId,
                productId: orderItems.productId,
                quantity: orderItems.quantity,
                price: orderItems.price,
                productName: products.name, // Include product name
                productPrice: products.price, // Include product price
                productDescription: products.description, // Include product description
                productStock: products.stock, // Include product stock
                productImageUrl: products.imageUrl, // Include product image URL
                productCategory: products.category, // Include product category
            })
            .from(orderItems)
            .innerJoin(products, eq(orderItems.productId, products.id)) // Join with products table
            .where(eq(orderItems.orderId, order.id)); // Filter by order ID
        const items: (OrderItem & { product: Product })[] = orderItemsList.map(item => ({
            id: item.id,
            orderId: item.orderId,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            product: {
                id: item.productId,
                name: item.productName,
                description: item.productDescription,
                price: item.productPrice,
                stock: item.productStock,
                imageUrl: item.productImageUrl,
                category: item.productCategory,
            },
        }));
        result.push({
            ...order,
            items,
            user: { username: order.username }, // Replace with actual total calculation if available
            shippingAddress: order.shippingAddress || null, // Replace with actual shipping address if available
            total:order.total, // Replace with actual shipping address if available
            deliveryDate: order.deliveryDate, 
            trackingNumber: order.trackingNumber, 
            middlemanId: order.middlemanId,
        });
    }
    return result;
}
async updateOrderStatus(orderId: number, status: Order['status']): Promise<Order | undefined> {
  const [updatedOrder] = await db
      .update(orders)
      .set({ 
          status:status,
          updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();
  return updatedOrder;
}
async getApprovedOrders( user_id:number): Promise<Order[]> {
  return await db
      .select()
      .from(orders)
      .where(eq(orders.middlemanId, user_id))
      .orderBy(sql`${orders.createdAt} DESC`);
}
async deleteOrder(orderId: number): Promise<boolean> {
  const result = await db
      .delete(orders)
      .where(eq(orders.id, orderId));
  return result !== null;
}
async assignOrderToMiddleman(orderId: number): Promise<void> {
  const [middleman] = await db
      .select()
      .from(users)
      .where(eq(users.isMiddleman, true))
      .limit(1);
  if (middleman) {
      await db
          .update(orders)
          .set({ middlemanId: middleman.id })
          .where(eq(orders.id, orderId));
  } else {
      throw new Error('No available middleman found');
  }
}
  async seedInitialData() {
    const adminUser = await this.getUserByUsername("admin");
    if (!adminUser) {
      await this.createUser({
        username: "admin",
        password: "admin123",
        email: "smuthumalai2@gmail.com",
        isAdmin: true,
      });
    }   
  }
}
export const storage = new DatabaseStorage();