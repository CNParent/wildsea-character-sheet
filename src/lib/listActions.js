export default {
    move: (collection, n, item) => {
        let index = collection.indexOf(item);
        collection.splice(index, 1);

        index += n;
        if (index < 0) index = collection.length;
        else if (index > collection.length) index = 0;

        collection.splice(index, 0, item);
        collection = collection;
    },
    remove: (collection, item) => {
        let index = collection.indexOf(item);
        collection.splice(index, 1);
        collection = collection;
    }
}
