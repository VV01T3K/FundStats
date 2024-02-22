import type { Component } from "solid-js";
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from "./drawer";
import { Button } from "./button";
import "@/styles/MyAsideCard.css";

export const MyAsideCard: Component = () => {
    return (
        <Drawer>
            <DrawerTrigger>
                <Button>Open Drawer</Button>
            </DrawerTrigger>
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>Are you absolutely sure?</DrawerTitle>
                    <DrawerDescription>This action cannot be undone.</DrawerDescription>
                </DrawerHeader>
                <div class="myflex">
                    <DrawerClose>
                        <Button class="imgButton" variant="outline">
                            <img src="coinmarketcap.svg" alt="coinmarketcap" />
                        </Button>
                        <Button class="imgButton" variant="outline">
                            <img src="coinpaprika.svg" alt="coinpaprika" />
                        </Button>
                    </DrawerClose>
                </div>
                <DrawerFooter>
                    <DrawerClose>
                        <Button variant="outline">Cancel</Button>
                    </DrawerClose>
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
    );
};
