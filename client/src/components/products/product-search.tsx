import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
interface ProductSearchProps {
  searchQuery: string;
  categoryFilter: string;
  stockFilter: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onStockChange: (value: string) => void;
  onResetFilters: () => void;
}
const categories = [
  "Electronics",
  "Clothing",
  "Home & Kitchen",
  "Books",
  "Sports",
  "Health",
  "Outdoor",
];
export default function ProductSearch({
  searchQuery,
  categoryFilter,
  stockFilter,
  onSearchChange,
  onCategoryChange,
  onStockChange,
  onResetFilters
}: ProductSearchProps) {
const {user}=useAuth();
const clasname= user?.isAdmin ? "grid grid-cols-1 md:grid-cols-4 gap-4" : "grid grid-cols-1 md:grid-cols-3 gap-4";
  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className={clasname}>
         <div className="space-y-2">
            {/* <Label htmlFor="search">Search</Label> */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            {/* <Label htmlFor="category">Category</Label> */}
            <Select value={categoryFilter} onValueChange={onCategoryChange}>
              <SelectTrigger id="category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {user?.isAdmin && (
            <div className="space-y-2">
            <Select value={stockFilter} onValueChange={onStockChange}>
              <SelectTrigger id="stock">
                <SelectValue placeholder="All Stock Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stock Status</SelectItem>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="low_stock">Low Stock</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
          )}
          
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={onResetFilters}
              disabled={!searchQuery && categoryFilter === "all" && stockFilter === "all"}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Reset Filters
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
